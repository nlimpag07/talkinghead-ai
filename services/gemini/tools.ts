import { Type, type FunctionDeclaration } from "@google/genai";

/**
 * The retrieval tool, declared once and shared.
 *
 * Not `server-only`: the declaration is pinned to the ephemeral token on the
 * server, but the browser needs the same `name` to route an incoming tool call
 * to a handler. One constant means those cannot drift apart — a mismatch would
 * surface as the model calling something that silently never responds, which
 * stalls the turn with no error anywhere.
 *
 * The seeded persona also refers to this tool by name. Renaming it here means
 * renaming it in `prisma/seed.ts` and bumping the prompt version.
 */
export const SEARCH_KNOWLEDGE = "search_knowledge";

/**
 * Declared on the session, so it sits inside the cached prefix alongside the
 * instructions and has to be as byte-stable as they are.
 *
 * The description is written at the model, not at a developer: it has to
 * induce a call on the first mention of anything company-specific, because the
 * alternative failure is the model answering a question about the business from
 * its own weights. Verified to fire — "What time do you close?" produced
 * `search_knowledge({query: "closing time"})`, translated to English keywords
 * as instructed.
 */
export const SEARCH_KNOWLEDGE_DECLARATION: FunctionDeclaration = {
  name: SEARCH_KNOWLEDGE,
  description:
    "Search the company's own documentation. Call this before answering any question about this company — its services, hours, prices, policies, locations, people, or processes — even if you believe you already know the answer. Call it again with different wording if the first result is not useful.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "What to look up, as a short phrase in English. Translate the visitor's Taglish or Bisaya into English keywords first — the documentation is in English.",
      },
    },
    required: ["query"],
  },
};
