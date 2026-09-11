# Vocabulary source

English to Tagalog and Bisaya (Cebuano) reference. These files are the source
for `prisma/vocabulary.ts`, which is folded into the persona prompt.

**These are not knowledge-base content.** They are deliberately outside
`./knowledge` so `npm run kb:ingest` does not index them.

The reason is measured, not stylistic. When this material was in the knowledge
base, retrieval performed badly on it: each chunk held dozens of unrelated word
pairs, so its embedding averaged into something no single query matched
strongly. "How do you count to ten" retrieved the adjectives file; bare lookups
like "thank you" or "water" returned nothing at all. Dense vector search is the
wrong instrument for exact-term lookup.

In the prompt instead, every word is available on every turn, and the
instructions are the prompt-cached prefix so it costs almost nothing after the
first turn.

## Regenerating after an edit

`prisma/vocabulary.ts` is generated from these files, not hand-maintained. The
extractor parses the prose form:

    "X" is "Y" in Tagalog and "Z" in Bisaya.
    "X" is "Y" in both languages.
    "X" and "Y" are "Z" in Tagalog and "W" in Bisaya.
    "X" can be "A" or "B" in Tagalog and "C" or "D" in Bisaya.

Keep that shape when adding entries, or the line is skipped. After editing,
regenerate `prisma/vocabulary.ts`, bump `PERSONA_VERSION` in `prisma/seed.ts`,
and re-seed. The version bump matters: prompts are versioned so a bad edit is
revertible by flipping `isActive` rather than restoring a row.

`./knowledge` is for company documentation — hours, services, policies, prices.
That is what the assistant is grounded on, and what `search_knowledge` queries.
