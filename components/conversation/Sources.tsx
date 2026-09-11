"use client";

import type { KnowledgeSource } from "@/types/knowledge";

/**
 * Citations for the current answer. Shown, never spoken — the persona is two
 * or three sentences and reading source titles aloud would wreck that.
 *
 * The score is displayed because it is the one number that explains a bad
 * answer: a confident reply built on a 0.31 match is a threshold problem, not
 * a model problem, and without this you cannot tell those apart.
 */
export function Sources({
  sources,
}: {
  readonly sources: readonly KnowledgeSource[];
}) {
  if (sources.length === 0) return null;

  return (
    <section
      aria-label="Sources for the current answer"
      className="pointer-events-auto text-right"
    >
      <h2 className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-ink-muted">
        Answered from
      </h2>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {sources.map((source) => (
          <li key={source.chunkId} className="text-sm">
            <div className="flex items-baseline justify-end gap-3">
              <span className="font-medium">
                {source.sourceUrl ? (
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-1 underline-offset-2"
                  >
                    {source.documentTitle}
                  </a>
                ) : (
                  source.documentTitle
                )}
              </span>
              <span
                className="shrink-0 text-xs tabular-nums text-ink-muted"
                title="Cosine similarity to the question"
              >
                {source.score.toFixed(2)}
              </span>
            </div>
            {source.heading ? (
              <p className="text-xs text-ink-muted">{source.heading}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
