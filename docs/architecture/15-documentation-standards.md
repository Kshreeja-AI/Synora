# Documentation Standards

## Three kinds of documentation, three homes

1. **Package READMEs** (`<package>/README.md`) — mandatory for every package. States what
   layer the package is in, what it depends on and _why_, and what it exports. Written for
   someone who has never seen the package before deciding whether to depend on it.
2. **Architecture docs** (`docs/architecture/*.md`, this directory) — how a cross-cutting
   concern works _today_, referencing real files/packages, not hypotheticals.
3. **ADRs** (`docs/architecture/decisions/ADR-*.md`) — why a decision was made, what
   alternatives were considered and rejected, and what would make it worth revisiting.
   Never edited after merge; a changed decision is a new ADR that supersedes the old one
   (link both directions when that happens).

## ADR format

Every ADR follows: **Status** (Accepted — nothing in this repo ships as Proposed) →
**Context** (the problem, unconstrained by the answer) → **Decision** (what we're doing) →
**Alternatives considered** (what else was on the table and why it lost) →
**Consequences** (what this costs us, not just what it buys us).

## Code-level documentation (TSDoc)

A one-to-a-few-line `/** ... */` comment above an exported symbol only when the _why_ isn't
obvious from the name and signature — a non-obvious invariant, a constraint from a
consuming layer, a link to the ADR that explains a non-default choice. No comment
restating what a well-named function obviously does. No multi-paragraph docstrings. See
any port interface in `packages/application/src/ports/*.ts` for the target density: one
line explaining which `.env.example` default it corresponds to and which package
implements it, nothing more.

## Keeping docs from rotting

- Every `README.md` and architecture doc references real package/file names — if a
  referenced path is renamed, grep for it; a broken reference is a bug.
- `docs/architecture/README.md`'s index tables are the single list of what exists — a new
  topic doc or ADR is added there in the same change that adds the doc itself.
- Comments never reference "the current task," a ticket number, or "recently added" — they
  describe the code as it is, because that framing rots the moment the PR merges (see the
  repo-wide comment-style rule: explain the _why_ that will still be true in a year, not
  the history of how it got here).
