"use client";

import { useCallback, useRef, useState } from "react";
import { toToolOutput } from "@/lib/knowledge-output";
import type {
  KnowledgeSearchResponse,
  KnowledgeSource,
  RealtimeToolCall,
} from "@/types/knowledge";

const SEARCH_KNOWLEDGE = "search_knowledge";

/** Kept for the citation panel. Older retrievals are dropped — the panel shows
 *  what grounded the current answer, not a session-long audit trail. */
const MAX_TRACKED = 8;

export interface UseKnowledgeTool {
  /** Sources behind the most recent retrieval, best match first. */
  readonly sources: readonly KnowledgeSource[];
  /** Passed to `useRealtimeSession` as `onToolCall`. */
  execute: (call: RealtimeToolCall) => Promise<string>;
  reset: () => void;
}

/**
 * Executes the retrieval tool in the browser.
 *
 * This runs client-side because the sideband WebSocket was declined — see
 * PROGRESS.md. The consequence worth restating at the call site: the model's
 * arguments arrive here having passed through the visitor's machine, and
 * `/api/knowledge/search` is reachable without them. So the query is treated
 * as untrusted input on both sides of the boundary, and the server re-bounds
 * everything this hook sends.
 */
export function useKnowledgeTool(): UseKnowledgeTool {
  const [sources, setSources] = useState<readonly KnowledgeSource[]>([]);

  // Retrievals can overlap if the model issues two calls in one turn. Only the
  // newest gets to set the panel, so a slow earlier lookup cannot overwrite it.
  const generationRef = useRef(0);

  const execute = useCallback(async (call: RealtimeToolCall): Promise<string> => {
    if (call.name !== SEARCH_KNOWLEDGE) {
      return JSON.stringify({
        error: `Unknown tool ${call.name}.`,
      });
    }

    const query = parseQuery(call.argumentsJson);
    if (!query) {
      // The model produced arguments that do not parse. Told plainly so it can
      // retry, rather than returning an empty result it would read as "no
      // such documentation".
      return JSON.stringify({
        error: "The query argument was missing or not a string. Call again with a short English phrase.",
      });
    }

    const generation = ++generationRef.current;

    const response = await fetch("/api/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      // Thrown, not returned: the transport hook turns a rejection into the
      // "lookup failed" output, so the failure text lives in one place.
      throw new Error(`Knowledge search returned ${response.status}`);
    }

    const body = (await response.json()) as KnowledgeSearchResponse;
    const found = Array.isArray(body.sources) ? body.sources : [];

    if (generation === generationRef.current) {
      setSources(found.slice(0, MAX_TRACKED));
    }

    return toToolOutput(found);
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    setSources([]);
  }, []);

  return { sources, execute, reset };
}

function parseQuery(argumentsJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const query = (parsed as Record<string, unknown>).query;
  if (typeof query !== "string") return null;

  const trimmed = query.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : null;
}
