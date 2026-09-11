/**
 * Structure-aware chunking for Markdown and plain text.
 *
 * Boundaries are chosen by document structure — heading, then blank line, then
 * sentence — rather than by cutting at a fixed offset. This matters more than
 * chunk size does: a passage severed mid-sentence embeds as something close to
 * noise, and a retrieval hit on it reads as a non-answer even when the right
 * document was found.
 *
 * `tokenCount` is an estimate. It feeds cost display and context budgeting,
 * never a hard limit, so a real tokenizer would buy precision nothing here
 * depends on. The 4-chars-per-token ratio is conservative for English and
 * loose for Taglish, which shares English's Latin script and short words.
 */

/** ~300 tokens. Small enough that a hit is mostly signal, large enough to
 *  carry a complete thought. */
const TARGET_CHARS = 1200;
/** Hard ceiling before a paragraph is split mid-sentence. */
const MAX_CHARS = 1800;
/** Carried between adjacent chunks so a fact spanning a boundary survives in
 *  at least one of them. */
const OVERLAP_CHARS = 150;
/** Below this a passage is too small to stand alone as a retrieval unit. It is
 *  merged backwards, never discarded — see `flush`. */
const MIN_CHARS = 40;

const CHARS_PER_TOKEN = 4;

export interface Chunk {
  readonly ordinal: number;
  readonly content: string;
  readonly tokenCount: number;
  /** Nearest enclosing Markdown heading, if any. Denormalised onto the chunk
   *  row so a citation can name the section without re-parsing the source. */
  readonly heading: string | null;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function chunkText(source: string): Chunk[] {
  const blocks = splitIntoBlocks(normalise(source));
  const chunks: Chunk[] = [];

  let buffer = "";
  let bufferHeading: string | null = null;
  let heading: string | null = null;

  const flush = (): void => {
    const content = buffer.trim();
    buffer = "";
    if (content.length === 0) return;

    // A passage below MIN_CHARS is a poor retrieval unit on its own, but
    // dropping it loses the text outright. It is merged into the preceding
    // chunk when they share a section, and emitted undersized otherwise.
    //
    // Discarding was the original behaviour and it was wrong in the worst
    // direction for this knowledge base: the shortest passages are the
    // most-asked facts. "We close at 5pm." is seventeen characters.
    if (content.length < MIN_CHARS) {
      const previous = chunks[chunks.length - 1];
      if (previous && previous.heading === bufferHeading) {
        const merged = `${previous.content}\n\n${content}`;
        chunks[chunks.length - 1] = {
          ...previous,
          content: merged,
          tokenCount: estimateTokens(merged),
        };
        return;
      }
    }

    chunks.push({
      ordinal: chunks.length,
      content,
      tokenCount: estimateTokens(content),
      heading: bufferHeading,
    });
  };

  for (const block of blocks) {
    const asHeading = headingText(block);

    if (asHeading !== null) {
      // A heading starts a new chunk. Sections are the strongest available
      // signal about what belongs together.
      flush();
      heading = asHeading;
      bufferHeading = heading;
      continue;
    }

    for (const piece of splitOversized(block)) {
      if (buffer.length === 0) {
        bufferHeading = heading;
        buffer = piece;
        continue;
      }

      if (buffer.length + piece.length + 2 <= TARGET_CHARS) {
        buffer = `${buffer}\n\n${piece}`;
        continue;
      }

      const carry = tailOverlap(buffer);
      flush();
      bufferHeading = heading;
      buffer = carry ? `${carry}\n\n${piece}` : piece;
    }
  }

  flush();
  return chunks;
}

function normalise(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    // Zero-width and BOM characters survive PDF and web extraction and break
    // both heading detection and sentence splitting.
    .replace(/[​-‍﻿]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Paragraph blocks. Markdown's own block separator is the blank line. */
function splitIntoBlocks(source: string): string[] {
  return source
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/** ATX headings only. Setext underlining is rare in generated docs and
 *  ambiguous against tables and horizontal rules. */
function headingText(block: string): string | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(block);
  if (!match) return null;
  const text = match[2]?.trim();
  return text && text.length > 0 ? text : null;
}

/** Splits a block that exceeds MAX_CHARS on sentence boundaries, falling back
 *  to a hard cut only for text with no sentence punctuation at all. */
function splitOversized(block: string): string[] {
  if (block.length <= MAX_CHARS) return [block];

  const sentences = block.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g);
  const units = sentences && sentences.length > 1 ? sentences : hardCut(block);

  const pieces: string[] = [];
  let current = "";

  for (const unit of units) {
    const next = unit.trim();
    if (next.length === 0) continue;

    if (current.length === 0) {
      current = next;
    } else if (current.length + next.length + 1 <= TARGET_CHARS) {
      current = `${current} ${next}`;
    } else {
      pieces.push(current);
      current = next;
    }
  }

  if (current.length > 0) pieces.push(current);
  return pieces;
}

function hardCut(block: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < block.length; i += TARGET_CHARS) {
    out.push(block.slice(i, i + TARGET_CHARS));
  }
  return out;
}

/** Trailing sentence of the previous chunk, to prefix the next one. Cut at a
 *  sentence start where possible so the overlap reads as prose. */
function tailOverlap(buffer: string): string {
  if (buffer.length <= OVERLAP_CHARS) return buffer;
  const tail = buffer.slice(-OVERLAP_CHARS);
  const boundary = tail.search(/(?<=[.!?])\s+/);
  return boundary === -1 ? tail.trimStart() : tail.slice(boundary).trim();
}
