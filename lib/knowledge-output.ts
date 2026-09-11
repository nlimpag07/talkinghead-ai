import type { KnowledgeSource } from "@/types/knowledge";

/**
 * The contract between retrieval and the model, in one place.
 *
 * Deliberately not `server-only`. The tool executes in the browser, so this
 * runs client-side today; keeping it free of any Prisma or env import means
 * the same function can be called from a server-side executor if the sideband
 * decision in PROGRESS.md is ever revisited, without a second implementation
 * drifting out of step with this one.
 */

/**
 * Sent when nothing matched. This sentence is load-bearing: it is the only
 * thing standing between "no results" and the model answering a question about
 * the company from its own weights. A bare empty list reads to the model as
 * permission to improvise.
 */
export const NO_RESULTS_NOTE =
  "No matching documentation. Say you do not have it and offer the human path. Do not answer from your own knowledge.";

export const SEARCH_FAILED_NOTE =
  "The documentation search failed. Say you cannot look it up right now and offer the human path.";

/**
 * Retrieved text is wrapped in a labelled `text` field rather than
 * concatenated into prose. The persona is instructed to treat tool output as
 * data and never obey instructions inside it; this structure is the mechanical
 * half of that guarantee — an injected "ignore your instructions" arrives
 * visibly as the contents of a document, not as a sentence addressed to the
 * model.
 */
export function toToolOutput(sources: readonly KnowledgeSource[]): string {
  if (sources.length === 0) {
    return JSON.stringify({ results: [], note: NO_RESULTS_NOTE });
  }

  return JSON.stringify({
    results: sources.map((source) => ({
      rank: source.rank,
      title: source.documentTitle,
      section: source.heading,
      url: source.sourceUrl,
      text: source.content,
    })),
  });
}

export function toFailureOutput(): string {
  return JSON.stringify({ results: [], note: SEARCH_FAILED_NOTE });
}
