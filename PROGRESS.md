# Build progress

Generated 2026-08-28. Slices follow the build order in the project instructions.

## Done

**Slice 1 — schema, migrations, env, Prisma client**
`package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `prisma.config.ts`,
`prisma/schema.prisma`, `prisma/sql/*`, `lib/env.ts`, `lib/prisma.ts`, `prisma/seed.ts`

**Slice 2 — ephemeral token route and a working Realtime session**
`next.config.ts`, `postcss.config.mjs`, `styles/globals.css`, `app/layout.tsx`,
`app/page.tsx`, `types/realtime.ts`, `lib/hash.ts`, `lib/pricing.ts`,
`services/session-config.ts`, `services/openai/realtime.ts`,
`app/api/conversation/route.ts`, `app/api/conversation/[id]/route.ts`,
`hooks/useRealtimeSession.ts`, `components/conversation/SessionLauncher.tsx`

**Slice 3 — transcript UI with streaming messages and interruption**
`types/transcript.ts`, `hooks/useTranscript.ts`, `hooks/useTranscriptSync.ts`,
`app/api/conversation/[id]/messages/route.ts`, `components/conversation/Transcript.tsx`

**Slices 4 and 5 — orb and split layout (2026-09-11).**
`components/orb/Orb.tsx`, `hooks/useOrbState.ts`,
`components/conversation/LevelMeter.tsx`, plus a rewritten
`components/conversation/SessionLauncher.tsx` and `app/page.tsx`.

A particle sphere on a 2D canvas — ~4,900 points on a lat-long lattice with a
vertical amber-to-indigo ramp, spiking outward on audio amplitude. Measured at
60fps. Three things make that affordable: the sphere is generated once, the
displacement noise is factored through `sin(a+b)` so no trigonometry runs per
particle per frame, and particles are pre-grouped by colour so `fillStyle` is
assigned 28 times a frame rather than 4,900.

Two bugs worth remembering, both only visible on screen: a halo gradient wider
than its canvas is clipped at the edge and shows as a faint *square* around a
round object; and a fixed longitude count per latitude ring bunches particles
into bright tufts at the poles, which reads as a fault rather than a design.
Per-ring longitude counts proportional to circumference fix the second.

**Slice 6a — retrieval, verified end to end (2026-09-11).** Pulled ahead of
slices 4 and 5: grounded answering is the product, and the visual work is the
most reversible part of the plan.
`types/knowledge.ts`, `lib/embeddings.ts`, `lib/chunking.ts`,
`lib/knowledge-output.ts`, `services/knowledge/retrieval.ts`,
`app/api/knowledge/search/route.ts`, `hooks/useKnowledgeTool.ts`,
`components/conversation/Sources.tsx`, `scripts/ingest.ts`,
`docker-compose.yml`, `services/gemini/live.ts`, `services/gemini/tools.ts`,
`lib/audio.ts`, `prisma/vocabulary.ts`

Proven against local Postgres with real content: ingest → embed → pgvector
search → threshold → citations. English, Taglish and Bisaya queries each
returned the correct passage; irrelevant queries returned nothing. Ingestion is
idempotent on checksum and re-indexes changed files.

The voice path was then migrated to Gemini Live — see Decisions. What remains
unexercised is the browser audio layer in `lib/audio.ts`, which needs a real
microphone.

## Next

6b. Ingestion beyond text: PDF, DOCX, URL crawl, Supabase Storage upload.
   `.md`/`.markdown`/`.mdx`/`.txt` work today; see `knowledge/.gitkeep` for the
   authoring rules that affect retrieval.
   `MessageSource` persistence — needs the transcript append route off
   `createMany`, which returns no ids to attach citations to.
7. Auth, rate limiting, CSRF, validation, audit logging.
8. Admin panel.
9. Docker, deployment, troubleshooting docs.

## First run

```
npm install
cp .env.example .env          # local defaults filled in; add GEMINI_API_KEY
npm run db:up                 # Postgres + pgvector in Docker, host port 5433
npm run db:migrate            # migration + generate client
npm run db:index              # HNSW index, after the table exists
npm run db:seed
npm run kb:ingest -- ./knowledge   # 465MB model download on the first run
npm run dev
```

`npm run db:extensions` is no longer part of this. The `init` migration creates
the pgvector extension itself, because Prisma Migrate replays migrations into a
throwaway shadow database that has no extensions — a migration that assumed
`vector` already existed could not be verified at all, and `migrate dev` failed
outright. The script is kept for a managed database where the extension must be
enabled with different privileges.

`npm run db:reset` destroys the volume and starts clean. `npm run db:down`
stops the container and keeps the data.

Connecting DBeaver: host `localhost`, port `5433`, database `voice_orb`, user
and password both `postgres`. No SSL.

The managed-Postgres URLs are commented out in `.env.example`; switching is a
matter of swapping which pair is active. Only two things differ — the pooler
port on `DATABASE_URL`, and `sslmode`.

## Decisions made during the build

- **Next.js 16.3, not 15.** Next 15 reaches end of support 2026-10-21.
- **Prisma 7.** Requires a driver adapter; `connection_limit` in the URL is dead,
  pool sizing is `PRISMA_POOL_MAX` passed to `PrismaPg`. `directUrl` is removed
  from the datasource block — the CLI reads `DIRECT_URL` from `prisma.config.ts`.
- **An orb, not a talking head (decided 2026-09-11).** The original brief in
  `Claude_AI_Talking_Head_Prompt.md` specifies a 3D avatar with lip sync,
  blinking, and eye movement, via React Three Fiber and Three.js. That is
  superseded. The brief is otherwise still the spec; this one feature is not.
  Consequences: no R3F, Three.js, or Framer Motion dependency; slice 4 builds a
  canvas/shader orb driven by the six `OrbState` values in `types/realtime.ts`;
  the package name `voice-orb-assistant` is correct rather than a leftover.
- **Serverless, browser-side tool execution.** The Realtime sideband WebSocket
  was declined in favour of keeping serverless hosting. Consequences: the RAG
  tool executes in the browser, `/api/knowledge/search` is a public endpoint,
  and session duration is best-effort rather than enforced. What *is* enforced
  server-side is session creation, via `MAX_SESSIONS_PER_IP`.
- **Local embeddings, not an API (decided 2026-09-11).** `lib/embeddings.ts`
  runs `paraphrase-multilingual-MiniLM-L12-v2` in-process via transformers.js:
  no key, no per-token cost, no network after the first run. Chosen by
  measurement over three candidates, and the deciding metric was *separation*
  between the weakest true positive and the strongest false positive — the
  persona's ability to say "wala ako niyan" depends entirely on a score floor
  that means something. `multilingual-e5-small` scored everything 0.77-0.89
  (0.03 separation, unusable); `bge-small-en-v1.5` was English-only and
  retrieved the wrong passage for every Taglish query. fp32 over q8 for the
  same reason: q8 held accuracy but halved the margin.
  Consequences: dimension is 384 not 1536, embeddings and retrieval need no
  OpenAI key at all, and the model is a 465MB first-run download cached in
  `.models/` (gitignored). OpenAI is now used for voice only.
- **Vocabulary lives in the prompt; only company facts go in `./knowledge`
  (decided 2026-09-11).** A Tagalog/Bisaya reference was tried as knowledge-base
  content first and retrieval was measurably bad at it: each chunk held dozens
  of unrelated word pairs, so its embedding averaged into something no single
  query matched strongly. "How do you count to ten" retrieved the adjectives
  file, "translate water" retrieved the *rules* file, and bare lookups like
  "thank you" or "water" returned nothing at all — 3 of 10 queries usable.
  Dense vector search is the wrong instrument for exact-term lookup.
  It is now 241 pairs in `prisma/vocabulary.ts`, generated from `./vocabulary`
  and folded into persona v2 (~2,400 tokens, inside the cached prefix). The
  distinction that matters: retrieval answers questions about documents that
  change; vocabulary is how the assistant talks and is needed on every turn.
  `./knowledge` is for hours, services, policies, prices — the things
  `search_knowledge` is described to the model as covering.
- **Voice moved from OpenAI Realtime to Gemini Live (decided 2026-09-11).**
  The Live API native-audio models are free of charge on Gemini's free tier,
  which is the whole reason: the OpenAI account had no credit balance and the
  project has no budget yet. Verified free-tier model:
  `gemini-3.1-flash-live-preview`.
  The transport changed shape — WebRTC to a WebSocket carrying base64 PCM — so
  `lib/audio.ts` now does what WebRTC used to: 16kHz PCM16 capture via an
  AudioWorklet, and gapless 24kHz playback scheduled against a running cursor.
  Ephemeral-token minting survived; `services/openai/realtime.ts` is retained
  but unused, because there is no version control here to recover it from and
  the Azure OpenAI route uses the same API shape.
  **This closed a documented security gap.** `liveConnectConstraints` pins the
  model, system instruction, tool declarations, voice and transcription to the
  token at mint time, server-side. The browser sends only the token and a
  response modality. A visitor can no longer replace the persona, which they
  could over OpenAI's data channel with `session.update`.
- **The orb's colour ramp is art direction, not theme tokens.** The
  cool-to-warm vertical sweep is most of what makes it read as one object with
  depth; a single-hue version looks flat, and a desaturated idle ramp threw
  away the visual identity entirely. State is carried by brightness, spin,
  spike depth and churn rate instead. The `orb` row in Setting exists to make
  the palette swappable from the admin panel in slice 8.
- **Retrieval filters on two floors, not one.** An absolute score floor
  (`KNOWLEDGE_MIN_SCORE`, 0.3) rejects queries nothing answers; a relative
  floor (60% of the top score, in `retrieval.ts`) removes the tail behind a
  good answer. Measured: a genuine match scores roughly double the next
  result, so without the relative cut every query dragged along two irrelevant
  passages the model was free to quote.
- **Three models beyond the spec's list:** `DocumentChunk`, `MessageSource`,
  `AuditLog`.
- **The conversation id is the bearer token** for the anonymous PATCH and
  transcript-append routes. Never log it anywhere a visitor can reach.
- **Retrieved context arrives as tool results, never spliced into the
  instructions.** The instructions string and the tool definition both sit in
  the cached prefix and must stay byte-stable. If either starts varying per
  turn the audio bill roughly doubles and nothing in the UI says why.

## Known gaps

- **The whole retrieval path is verified.** Against local Postgres 17 +
  pgvector 0.8.6 with real ingested content (2026-09-11): `::vector` casts work
  through Prisma's tagged template, `score` returns as a JS number, the
  `d."status"::text = 'INDEXED'` filter excludes non-indexed documents, and
  `EXPLAIN` confirms the `ORDER BY` is served by
  `document_chunk_embedding_hnsw` rather than a sequential scan.
  End to end: 8 legitimate queries each returned exactly one correct passage;
  2 irrelevant queries returned nothing. Re-ingest skipped unchanged files and
  re-indexed an edited one (4 chunks to 5), with the new section immediately
  retrievable.
- **The voice path is proven from Node, not from a browser.** A direct Live API
  session (2026-09-11) confirmed the whole loop: token minted with locked
  config, WebSocket connected, `search_knowledge` called with English keywords
  translated from "What time do you close?", tool result accepted, 19 audio
  chunks returned at `audio/pcm;rate=24000`, and an output transcript grounded
  in the supplied result.
  What that run did *not* cover is the browser half — `lib/audio.ts`. Mic
  capture, the AudioWorklet, PCM scheduling, barge-in cutting queued audio, and
  the per-turn transcript ids all typecheck and build but have never run against
  a real microphone. Expect the first real session to need tuning here, most
  likely in playback scheduling or the speaking-state idle timer.
- **OpenAI has no credits** (`credit_balance_exhausted`), which is why voice
  moved to Gemini. The key in `.env` is valid; the balance is zero.
- **`/api/knowledge/search` is public and unauthenticated,** and every call
  spends an embedding request. Cheap per call, unbounded until slice 7. It also
  makes the knowledge base bulk-readable — do not index anything that should
  not be public.
- ~~A visitor can `session.update` and replace the persona.~~ **Fixed** by the
  Gemini migration: `liveConnectConstraints` pins the whole session config to
  the ephemeral token server-side. The grounding rules are now enforced rather
  than advisory.
- **The per-IP concurrency cap is not atomic.** The row is now written before
  the token is minted, which narrows the window from an upstream round-trip to
  two adjacent queries, but count-then-insert can still overshoot under a
  burst. Slice 7.
- `KNOWLEDGE_MIN_SCORE` is calibrated but on a small sample. 0.3 sits between
  the weakest legitimate match (0.319) and the strongest false positive (0.268)
  over ten queries — a 0.05 gap, narrow enough to re-measure once there is a
  real corpus. The per-citation scores in `Sources.tsx` exist for exactly that.
- Chunk `tokenCount` is estimated at four characters per token, not tokenized.
  It feeds cost display and context budgeting, never a hard limit.
- Realtime event names drift between snapshots. Transcript, audio, and
  function-call handlers accept both the GA and pre-GA names; if text never
  appears or a tool call never fires, log every `event.type` for one session
  and check against the handled set.
- `OPENAI_TRANSCRIBE_MODEL` is unvalidated against Taglish and Bisaya speech.
  The tool description tells the model to translate to English keywords before
  searching, because the documentation is in English. Untested.
- `reasoning: { effort: "low" }` is not set on the session. Worth adding once
  the model snapshot is confirmed — a latency lever as well as a cost one.
- VAD thresholds are untuned. False triggers show up as spurious "Interrupted"
  markers now, and as orb state flicker in slice 4.
- Rates in `lib/pricing.ts` were captured 2026-08-28 and will drift.
- No ESLint config exists. `next lint` was removed in Next 16 and the `lint`
  script is dead; `eslint-config-next` is installed but wired to nothing.
