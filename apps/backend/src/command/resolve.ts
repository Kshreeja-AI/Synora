/**
 * Entity resolution: from a mention in a sentence to a real record.
 *
 * THE MISSING DEPENDENCY, BUILT FIRST. Reading the code showed why most
 * remaining capabilities cannot be bound: they need a specific THING — an
 * agent, a workflow, a tool — and a sentence names things loosely ("the
 * research agent"), while every service wants an id. This module is the
 * bridge, and it is a primitive on purpose: the matcher is pure and takes
 * any named candidates, so each future binding reuses ONE definition of
 * "which thing did the person mean" instead of growing its own.
 *
 * DETERMINISTIC AND LOCAL, like the understander, and for the same reason:
 * the thing standing between hostile text and Synora's capabilities must
 * not be persuadable, and "which agent did you mean" must still work when
 * every provider is down. A model may later RANK suggestions; it must never
 * become the thing that decides which record a command touches.
 *
 * THE ONE RULE THAT MATTERS: when not exactly one candidate matches, this
 * NEVER guesses. A wrong guess here is the worst outcome the command layer
 * can produce — a confident action on a record nobody named — and it is
 * worse than any question. Ambiguity comes back as candidates for a person
 * to choose from, capped, never silently truncated to a "best" one.
 *
 * Workspace scoping is the CALLER's list: resolution operates only on
 * candidates the caller already fetched with a workspace-scoped query, so
 * this module cannot be the place where isolation leaks. It never queries.
 */

export interface NamedCandidate {
  id: string;
  name: string;
}

export type NameResolution<T extends NamedCandidate> =
  | { status: 'resolved'; entity: T }
  | {
      /**
       * Not exactly one match. `matched` holds what DID match (empty when
       * nothing did) so the caller can ask a precise question — "did you
       * mean A or B?" beats "which agent?" when the person was close.
       */
      status: 'unresolved';
      matched: T[];
    };

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Whole-word presence: "research" is in "the research agent"; not in "researcher". */
function containsWholeWord(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const at = haystack.indexOf(needle);
  if (at === -1) return false;
  const before = at === 0 ? ' ' : haystack[at - 1];
  const afterIndex = at + needle.length;
  const after = afterIndex >= haystack.length ? ' ' : haystack[afterIndex];
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

/**
 * Which candidate does this mention name?
 *
 * 1. Exact name match (case/whitespace-insensitive). Exactly one → done.
 * 2. Whole-word presence of the candidate's full name inside the mention.
 * 3. MOST-SPECIFIC-WINS tie-break: if one matched name strictly contains
 *    another matched name, the longer wins — a person who said
 *    "daily digest v2" did not mean "daily digest", even though both
 *    matched. Applied only when it leaves exactly one; two unrelated
 *    matches stay ambiguous.
 *
 * Anything other than exactly one survivor is `unresolved`, with the
 * matches attached. Deterministic throughout: same inputs, same answer.
 */
export function resolveByName<T extends NamedCandidate>(
  candidates: readonly T[],
  mention: string
): NameResolution<T> {
  const subject = normalize(mention);

  const exact = candidates.filter((c) => normalize(c.name) === subject);
  if (exact.length === 1) return { status: 'resolved', entity: exact[0] };
  if (exact.length > 1) return { status: 'unresolved', matched: exact };

  const contained = candidates.filter((c) => containsWholeWord(subject, normalize(c.name)));
  if (contained.length === 1) return { status: 'resolved', entity: contained[0] };

  if (contained.length > 1) {
    // Most specific wins, and only when that leaves a single survivor.
    const survivors = contained.filter(
      (c) =>
        !contained.some(
          (other) =>
            other !== c &&
            normalize(other.name).length > normalize(c.name).length &&
            containsWholeWord(normalize(other.name), normalize(c.name))
        )
    );
    if (survivors.length === 1) return { status: 'resolved', entity: survivors[0] };
    return { status: 'unresolved', matched: survivors };
  }

  return { status: 'unresolved', matched: [] };
}

/** Cap a candidate list for a human sentence — never a wall of names. */
export function nameSample(candidates: readonly NamedCandidate[], max = 5): string {
  const names = candidates.slice(0, max).map((c) => `"${c.name}"`);
  const rest = candidates.length - names.length;
  return rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(', ');
}
