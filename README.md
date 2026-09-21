# Voice Orb Assistant

A voice-first AI front desk. Visitors speak to it in the browser and it answers
out loud, grounded in documents you provide — and says it doesn't know when they
don't cover the question.

The persona is **Tatay Dodong**, a retired public-market administrator from
Davao who speaks Taglish with Bisaya markers.

**It runs at zero marginal cost.** Postgres is a local container, embeddings run
in-process on the CPU, and the voice model is on Gemini's free tier. The only
credential you need is a free Gemini API key.

---

## How it works

```
browser ──── WebSocket (PCM audio) ────► Gemini Live API
   │                                          │
   │  ephemeral token                         │ "search_knowledge(query)"
   ▼                                          ▼
POST /api/conversation              POST /api/knowledge/search
   │                                          │
   │ mints a single-use token with the        │ local embedding → pgvector
   │ persona, tools and voice pinned to it    │ cosine search → score floors
   ▼                                          ▼
          Postgres + pgvector (Docker, port 5433)
```

Three things are worth knowing up front:

**The browser talks to Gemini directly.** Your API key never leaves the server.
It mints a single-use ephemeral token, and `liveConnectConstraints` pins the
model, system instruction, tool declarations and voice to that token
server-side — so a visitor cannot replace the persona from the client.

**Retrieval needs no API key.** `paraphrase-multilingual-MiniLM-L12-v2` runs
locally via transformers.js. First run downloads ~465MB to `.models/`
(gitignored); after that it is offline and free.

**Vocabulary is in the prompt, not the knowledge base.** Tagalog/Bisaya word
pairs live in the system instruction because vocabulary is needed on every turn
and dense vector search is poor at exact-term lookup. `./knowledge` is for
company facts only. See `vocabulary/README.md`.

---

## Quick start

Requires **Node 20.19+** and **Docker**.

```bash
npm install
cp .env.example .env
```

Add a free Gemini API key to `.env` — get one at
https://aistudio.google.com/apikey, no card required:

```
GEMINI_API_KEY="..."
```

Then:

```bash
npm run db:up        # Postgres + pgvector, host port 5433
npm run db:migrate   # apply migrations, generate the Prisma client
npm run db:index     # HNSW index (needs the table to exist first)
npm run db:seed      # settings, knowledge base, persona prompt
npm run dev
```

Open **http://localhost:3000** — not a LAN IP, see Troubleshooting.

At this point the assistant talks and answers language questions, but knows
nothing about your organisation. To fix that, put Markdown in `./knowledge`:

```bash
npm run kb:ingest -- ./knowledge
```

The first ingest downloads the embedding model and takes a minute. Subsequent
runs skip unchanged files.

---

## Environment variables

Everything except `GEMINI_API_KEY` has a working default in `.env.example`.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | **Required.** Free tier covers the Live API. |
| `GEMINI_LIVE_MODEL` | `gemini-3.1-flash-live-preview` |
| `GEMINI_VOICE` | Prebuilt voice. Overridden by the `voice` Setting row. |
| `GEMINI_LANGUAGE_CODE` | Accent/pronunciation, BCP-47. Defaults to `fil-PH`. |
| `DATABASE_URL` / `DIRECT_URL` | Same server locally; differ in production (pooler vs direct). |
| `PRISMA_POOL_MAX` | `1` on serverless, higher locally. |
| `KNOWLEDGE_TOP_K` | Max passages returned per search. |
| `KNOWLEDGE_MIN_SCORE` | Similarity floor. Calibrated to the local model — see `lib/env.ts`. |
| `SESSION_MAX_SECONDS` | Client-side cap; the server sweep is the backstop. |
| `MAX_SESSIONS_PER_IP` | Concurrent sessions per hashed IP. |
| `IP_HASH_SALT`, `BETTER_AUTH_SECRET` | 32+ chars. `openssl rand -base64 32`. |
| `OPENAI_*` | Unused. Retained for a switch back — see below. |

Visitor IPs are never stored raw, only as an HMAC keyed by `IP_HASH_SALT`.

---

## Project structure

```
app/
  api/conversation/         start, close, append transcript
  api/knowledge/search/     retrieval — public, unauthenticated
components/
  conversation/             captions, sources, level meter, controls
  orb/Orb.tsx               particle sphere on a 2D canvas
hooks/
  useRealtimeSession.ts     Gemini Live transport, tool dispatch, usage
  useTranscript.ts          streaming turns into a transcript
  useEphemeralMessages.ts   caption lifecycle: enter, dwell, leave
  useKnowledgeTool.ts       browser-side retrieval tool execution
lib/
  audio.ts                  PCM capture at 16kHz, playback at 24kHz
  embeddings.ts             local embedding model
  chunking.ts               structure-aware Markdown chunking
  env.ts                    validated environment
services/
  gemini/                   token minting, tool declaration, voice list
  knowledge/retrieval.ts    pgvector cosine search
  openai/realtime.ts        unused; kept for an Azure OpenAI switch
prisma/
  schema.prisma             conversations, messages, documents, chunks
  vocabulary.ts             generated from ./vocabulary
  seed.ts                   settings and the versioned persona prompt
knowledge/                  your company docs — see knowledge/.gitkeep
vocabulary/                 Tagalog/Bisaya source — see vocabulary/README.md
```

---

## Configuration

### The knowledge base

Drop `.md`, `.markdown`, `.mdx` or `.txt` in `./knowledge` and re-run
`npm run kb:ingest -- ./knowledge`. Idempotent on a content hash: unchanged
files are skipped, changed files are re-indexed wholesale.

**`knowledge/.gitkeep` documents the authoring rules that affect retrieval
quality.** The one that matters most: write each section so it stands alone.
The model sees the retrieved passage, not the document around it, so "it costs
50 pesos per hour" is useless out of context.

PDF, DOCX and URL sources are not implemented yet.

### Voice and accent

Both live on the `voice` row in `Setting`, which overrides the environment and
takes effect on the next conversation:

```bash
docker exec voice-orb-db psql -U postgres -d voice_orb \
  -c "UPDATE setting SET value='{\"name\":\"Orus\",\"languageCode\":\"en-PH\"}'::jsonb WHERE key='voice';"
```

Fifteen voices are listed in `services/gemini/voices.ts`; `Charon`, `Orus`,
`Fenrir` and `Iapetus` are the deeper ones. `languageCode` changes pronunciation
rather than which voice speaks — `fil-PH`, `en-PH`, `en-US`, `en-GB`, `en-AU`.

### The persona

`prisma/seed.ts`. Prompts are **versioned**, not mutated: edit the text, bump
`PERSONA_VERSION`, re-seed. Older versions are deactivated rather than deleted,
so a bad edit is reverted by flipping `isActive` instead of restoring a row.

Keep it byte-stable. The instructions are the prompt-cached prefix, and anything
that varies per turn quietly doubles the bill.

---

## Scripts

| Command | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | `prisma generate` then `next build` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:up` / `db:down` | Start/stop Postgres. `down` keeps the data. |
| `npm run db:reset` | **Destroys the volume.** Re-migrate, re-index, re-seed after. |
| `npm run db:migrate` | Apply migrations, regenerate the client |
| `npm run db:index` | HNSW index — after the table exists |
| `npm run db:seed` | Settings, knowledge base, persona |
| `npm run db:studio` | Prisma Studio |
| `npm run kb:ingest -- ./knowledge` | Index documents |

Connecting DBeaver: `localhost`, port `5433`, database `voice_orb`, user and
password both `postgres`, no SSL.

---

## Troubleshooting

**The microphone never prompts, or fails immediately.**
Use `http://localhost:3000`. `getUserMedia` requires a secure context, and
localhost is the only HTTP origin that qualifies — `http://192.168.x.x:3000`
will not work, so testing from a phone needs HTTPS.

**The assistant connects but never speaks, with no error anywhere.**
Suspect the voice name first. An unrecognised one is accepted by both the token
mint and the connect, and then the session simply stalls. `services/gemini/voices.ts`
validates against an allowlist and logs a warning, so check the server console.

**Captions appear but the transcript is empty, or vice versa.**
Gemini's message shapes move between model versions. Log every message in
`useRealtimeSession`'s `onmessage` and compare against what `useTranscript`
handles.

**`prisma migrate dev` fails with `type "vector" does not exist`.**
Migrate replays into a throwaway shadow database that has no extensions. The
`init` migration creates the extension itself for this reason — if you write a
new migration that assumes `vector` exists, it cannot be verified.

**Every route returns 500 at startup.**
Check `.env` for a required variable set to `""`. Optional ones tolerate empty
strings; required ones do not.

**`npm run dev` says another dev server is already running.**
Next 16 holds a lock. If the named PID is dead, the lock is stale — kill
whatever holds port 3000 and retry.

**`npm run lint` does nothing useful.**
`next lint` was removed in Next 16 and there is no ESLint config in the repo.
`eslint-config-next` is installed but wired to nothing.

---

## Deployment

Not done yet, and two things block it:

- **`/api/knowledge/search` is public and unauthenticated**, and there is no
  rate limiting anywhere. Fine on localhost; not fine on a URL.
- **Gemini's free tier may use submitted data to improve Google's models.** The
  paid tier does not. Worth confirming before real visitors use it.

When it does ship, the app is shaped for serverless (`runtime = "nodejs"` on
every route, `PRISMA_POOL_MAX=1`). The managed-Postgres URLs are commented out
in `.env.example`; only the pooler port and `sslmode` differ.

`services/openai/realtime.ts` is retained but unused. Azure OpenAI exposes the
same Realtime API with Entra ID auth, which is the likeliest production route.

---

## Status

**Working:** voice conversation with barge-in, grounded retrieval with
citations, local embeddings, streaming captions, the particle orb, transcript
persistence, per-session cost tracking.

**Not built:** authentication, rate limiting, audit logging, the admin panel,
PDF/DOCX/URL ingestion, `MessageSource` persistence, Docker deployment.

**`components/conversation/Transcript.tsx` is orphaned** — `FloatingTranscript`
replaced it and nothing imports it.

`PROGRESS.md` records what was built in what order and, more usefully, *why* —
including the decisions that are not obvious from the code: why embeddings are
local, why the vocabulary is not in the knowledge base, why retrieval filters on
two floors rather than one, and what each of those cost to get wrong.
