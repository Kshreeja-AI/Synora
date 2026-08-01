'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Zero-dependency markdown renderer tuned for chat messages.
 * Supports: headings, bold, italic, inline code, fenced code blocks,
 * links, ordered/unordered lists, blockquotes, hr, paragraphs, hard breaks.
 * All output is escaped — nothing here uses dangerouslySetInnerHTML.
 */

type Node =
  | { type: 'code'; lang: string; code: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'hr' }
  | { type: 'p'; text: string };

function parseBlocks(source: string): Node[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const nodes: Node[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      // Skip closing fence
      if (i < lines.length) i++;
      nodes.push({ type: 'code', lang, code: buf.join('\n') });
      continue;
    }

    // Horizontal rule
    if (/^(\s*)(-\s?){3,}\s*$/.test(line) || /^(\s*)(\*\s?){3,}\s*$/.test(line)) {
      nodes.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      nodes.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      nodes.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      nodes.push({ type: 'ol', items });
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      nodes.push({ type: 'quote', text: buf.join('\n') });
      continue;
    }

    // Blank line → paragraph boundary
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: accumulate until blank line or block start
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    nodes.push({ type: 'p', text: buf.join('\n') });
  }

  return nodes;
}

interface InlineToken {
  type: 'text' | 'code' | 'strong' | 'em' | 'link' | 'br';
  content?: string;
  href?: string;
}

/**
 * Inline parser: handles `code`, **bold**, *italic*, [text](url), and hard breaks.
 * Order matters — code fences swallow everything else.
 */
function parseInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const rest = input.slice(cursor);

    // Hard line break (two spaces at end of line → \n)
    if (rest[0] === '\n') {
      tokens.push({ type: 'br' });
      cursor += 1;
      continue;
    }

    // Inline code
    const codeMatch = rest.match(/^`([^`\n]+)`/);
    if (codeMatch) {
      tokens.push({ type: 'code', content: codeMatch[1] });
      cursor += codeMatch[0].length;
      continue;
    }

    // Bold
    const boldMatch = rest.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      tokens.push({ type: 'strong', content: boldMatch[1] });
      cursor += boldMatch[0].length;
      continue;
    }

    // Italic
    const italicMatch = rest.match(/^\*([^*\n]+)\*/) || rest.match(/^_([^_\n]+)_/);
    if (italicMatch) {
      tokens.push({ type: 'em', content: italicMatch[1] });
      cursor += italicMatch[0].length;
      continue;
    }

    // Link
    const linkMatch = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (linkMatch) {
      tokens.push({ type: 'link', content: linkMatch[1], href: linkMatch[2] });
      cursor += linkMatch[0].length;
      continue;
    }

    // Plain char
    tokens.push({ type: 'text', content: rest[0] });
    cursor += 1;
  }

  // Merge adjacent text tokens
  const merged: InlineToken[] = [];
  for (const tok of tokens) {
    const last = merged[merged.length - 1];
    if (tok.type === 'text' && last?.type === 'text') {
      last.content = (last.content || '') + (tok.content || '');
    } else {
      merged.push(tok);
    }
  }
  return merged;
}

function renderInline(tokens: InlineToken[], keyPrefix: string): React.ReactNode[] {
  return tokens.map((tok, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (tok.type) {
      case 'text':
        return <React.Fragment key={key}>{tok.content}</React.Fragment>;
      case 'br':
        return <br key={key} />;
      case 'strong':
        return (
          <strong key={key} className="font-semibold">
            {tok.content}
          </strong>
        );
      case 'em':
        return (
          <em key={key} className="italic">
            {tok.content}
          </em>
        );
      case 'code':
        return (
          <code
            key={key}
            className="rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 font-mono text-[0.9em]"
          >
            {tok.content}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {tok.content}
          </a>
        );
      default:
        return null;
    }
  });
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (insecure origin, permission) — silently ignore
    }
  }, [code]);

  return (
    <div className="group relative my-3 overflow-hidden rounded-md border border-border bg-muted/60">
      <div className="flex items-center justify-between border-b border-border bg-muted/80 px-3 py-1.5 text-xs">
        <span className="font-mono text-muted-foreground">{lang || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  const nodes = useMemo(() => parseBlocks(children || ''), [children]);

  return (
    <div className={className}>
      {nodes.map((node, idx) => {
        const key = `n-${idx}`;
        switch (node.type) {
          case 'code':
            return <CodeBlock key={key} code={node.code} lang={node.lang} />;
          case 'heading': {
            const cls = [
              'text-2xl font-semibold mt-4 mb-2',
              'text-xl font-semibold mt-4 mb-2',
              'text-lg font-semibold mt-3 mb-2',
              'text-base font-semibold mt-2 mb-1',
              'text-sm font-semibold mt-2 mb-1',
              'text-xs font-semibold mt-2 mb-1',
            ][node.level - 1];
            return React.createElement(
              `h${node.level}`,
              { key, className: cls },
              renderInline(parseInline(node.text), key)
            );
          }
          case 'ul':
            return (
              <ul key={key} className="my-2 list-disc space-y-1 pl-6">
                {node.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(parseInline(item), `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="my-2 list-decimal space-y-1 pl-6">
                {node.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(parseInline(item), `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote
                key={key}
                className="my-2 border-l-4 border-border pl-3 text-muted-foreground italic"
              >
                {renderInline(parseInline(node.text), key)}
              </blockquote>
            );
          case 'hr':
            return <hr key={key} className="my-4 border-border" />;
          case 'p':
            return (
              <p key={key} className="my-2 whitespace-pre-wrap leading-relaxed">
                {renderInline(parseInline(node.text), key)}
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
