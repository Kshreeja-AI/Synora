import { DocumentSection, DocumentType } from './types';

/**
 * Splits a raw document into structural sections *before* chunking
 * (`./chunker.ts`) — the coarse, format-aware pass; chunking is the
 * fine, size-bounded pass. Separating the two means a markdown document's
 * heading hierarchy survives into `DocumentSection.path` regardless of how
 * a section later gets sub-divided by chunk size.
 */

function splitPlain(content: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const paragraphs = content.split(/\n{2,}/);
  let cursor = 0;

  for (const paragraph of paragraphs) {
    if (paragraph.trim().length === 0) {
      cursor += paragraph.length + 2;
      continue;
    }
    const startOffset = content.indexOf(paragraph, cursor);
    sections.push({ path: [], text: paragraph, startOffset, endOffset: startOffset + paragraph.length });
    cursor = startOffset + paragraph.length;
  }

  return sections;
}

const MARKDOWN_HEADING = /^(#{1,6})\s+(.+)$/;

/**
 * Splits on markdown ATX headings (`#`..`######`), tracking a heading
 * stack so each section's `path` reflects its full heading hierarchy
 * (e.g. `["Architecture", "Providers"]` for a `### Providers` under an
 * `## Architecture`). Content before the first heading gets an empty path.
 */
function splitMarkdown(content: string): DocumentSection[] {
  const lines = content.split('\n');
  const sections: DocumentSection[] = [];
  const headingStack: { level: number; title: string }[] = [];

  let buffer: string[] = [];
  let bufferStartLine = 0;
  let cursor = 0;

  const flush = (endLineIndex: number) => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) {
      const startOffset = content.indexOf(buffer[0], cursor - buffer.join('\n').length - 1 >= 0 ? 0 : 0);
      const rawText = lines.slice(bufferStartLine, endLineIndex).join('\n');
      const offset = content.indexOf(rawText);
      sections.push({
        path: headingStack.map((h) => h.title),
        text,
        startOffset: offset >= 0 ? offset : startOffset,
        endOffset: (offset >= 0 ? offset : startOffset) + rawText.length,
      });
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(MARKDOWN_HEADING);

    if (match) {
      flush(i);
      bufferStartLine = i + 1;
      const level = match[1].length;
      const title = match[2].trim();
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
    } else {
      buffer.push(line);
    }
    cursor += line.length + 1;
  }
  flush(lines.length);

  return sections;
}

/**
 * Splits on blank-line-separated blocks, the same coarse boundary as
 * plain-text paragraphs — a simple heuristic that avoids adding a
 * language-parser dependency for real AST-aware splitting. A block whose
 * first line looks like a function/class/const declaration gets that
 * line recorded as its `path`, so a chunk can at least be attributed to
 * "the block starting with `function processOrder(...)`.
 */
const CODE_DECLARATION = /^\s*(export\s+)?(async\s+)?(function|class|const|let|var|def|type|interface)\s+\S+/;

function splitCode(content: string): DocumentSection[] {
  const blocks = splitPlain(content);
  return blocks.map((block) => {
    const firstLine = block.text.split('\n')[0];
    const path = CODE_DECLARATION.test(firstLine) ? [firstLine.trim()] : [];
    return { ...block, path };
  });
}

export function splitDocument(content: string, type: DocumentType = 'plain'): DocumentSection[] {
  if (content.trim().length === 0) return [];

  switch (type) {
    case 'markdown':
      return splitMarkdown(content);
    case 'code':
      return splitCode(content);
    case 'plain':
      return splitPlain(content);
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown document type: ${String(exhaustiveCheck)}`);
    }
  }
}
