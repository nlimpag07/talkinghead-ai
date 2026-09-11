import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { chunkText } from "../lib/chunking.js";
import { embedDocuments, warmEmbeddings } from "../lib/embeddings.js";

/**
 * Ingests Markdown and plain text from a directory into the default knowledge
 * base. Run with:
 *
 *   npm run kb:ingest -- ./knowledge
 *
 * Uses DIRECT_URL, not DATABASE_URL: this writes thousands of rows in one
 * transaction, which is a session the transaction pooler is the wrong side of.
 *
 * Idempotent per file. A file whose checksum is unchanged is skipped entirely;
 * a changed file has its chunks replaced wholesale rather than diffed, because
 * a chunk's ordinal shifts when text above it changes and a partial update
 * would leave stale passages behind under the wrong headings.
 *
 * PDF, DOCX, and URL sources are not handled here — each needs a parser
 * dependency, and the schema's DocumentSourceType already has room for them.
 */

const SUPPORTED = new Map<string, "MARKDOWN" | "TXT">([
  [".md", "MARKDOWN"],
  [".markdown", "MARKDOWN"],
  [".mdx", "MARKDOWN"],
  [".txt", "TXT"],
]);

const KNOWLEDGE_BASE_SLUG = "default";
const EMBED_BATCH = 64;

const connectionString = process.env.DIRECT_URL;
if (!connectionString) {
  throw new Error("DIRECT_URL is not set; ingestion needs a direct connection.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, max: 1 }),
});

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? "./knowledge");
  const files = await collectFiles(root);

  if (files.length === 0) {
    console.log(`No .md or .txt files under ${root}`);
    return;
  }

  const knowledgeBase = await prisma.knowledgeBase.findUnique({
    where: { slug: KNOWLEDGE_BASE_SLUG },
    select: { id: true },
  });

  if (!knowledgeBase) {
    throw new Error(
      `No knowledge base with slug "${KNOWLEDGE_BASE_SLUG}". Run \`npm run db:seed\` first.`,
    );
  }

  // Loading the model takes a few seconds, and on the very first run it also
  // downloads it. Done up front so the delay is not mistaken for a slow file.
  process.stdout.write("Loading embedding model... ");
  const modelStart = Date.now();
  await warmEmbeddings();
  console.log(`${Date.now() - modelStart}ms`);

  console.log(`Ingesting ${files.length} file(s) from ${root}\n`);

  let indexed = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const title = relative(root, file).replace(/\\/g, "/");
    try {
      const result = await ingestFile(knowledgeBase.id, file, title);
      if (result === "skipped") {
        skipped += 1;
        console.log(`  = ${title} (unchanged)`);
      } else {
        indexed += 1;
        console.log(`  + ${title} (${result} chunks)`);
      }
    } catch (error) {
      failed += 1;
      console.error(`  ! ${title}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\n${indexed} indexed, ${skipped} unchanged, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

async function ingestFile(
  knowledgeBaseId: string,
  path: string,
  title: string,
): Promise<number | "skipped"> {
  const raw = await readFile(path, "utf8");
  const checksum = createHash("sha256").update(raw).digest("hex");
  const sourceType = SUPPORTED.get(extname(path).toLowerCase()) ?? "TXT";

  // Title is the natural key for a file source. `sourceUrl` carries the unique
  // constraint in the schema and is null here, and Postgres treats nulls as
  // distinct, so it cannot serve as one.
  const existing = await prisma.document.findFirst({
    where: { knowledgeBaseId, title },
    select: { id: true, checksum: true },
  });

  if (existing?.checksum === checksum) return "skipped";

  const chunks = chunkText(raw);
  if (chunks.length === 0) {
    throw new Error("produced no chunks (file may be empty or boilerplate)");
  }

  const vectors = await embedAll(chunks.map((chunk) => chunk.content));

  const document = existing
    ? await prisma.document.update({
        where: { id: existing.id },
        data: {
          status: "PROCESSING",
          sourceType,
          checksum,
          byteSize: Buffer.byteLength(raw),
          mimeType: sourceType === "MARKDOWN" ? "text/markdown" : "text/plain",
          error: null,
        },
        select: { id: true },
      })
    : await prisma.document.create({
        data: {
          knowledgeBaseId,
          title,
          sourceType,
          status: "PROCESSING",
          checksum,
          byteSize: Buffer.byteLength(raw),
          mimeType: sourceType === "MARKDOWN" ? "text/markdown" : "text/plain",
        },
        select: { id: true },
      });

  // One transaction: a document is either fully re-indexed or untouched. A
  // half-replaced document would answer questions from a mix of two versions.
  await prisma.$transaction(async (tx) => {
    await tx.documentChunk.deleteMany({ where: { documentId: document.id } });

    await tx.documentChunk.createMany({
      data: chunks.map((chunk) => ({
        documentId: document.id,
        ordinal: chunk.ordinal,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        documentTitle: title,
        heading: chunk.heading,
      })),
    });

    // Embeddings go in separately because `embedding` is Unsupported() —
    // Prisma can create the row but not write that column. Matched back up by
    // ordinal, which is unique per document.
    const written = await tx.documentChunk.findMany({
      where: { documentId: document.id },
      select: { id: true, ordinal: true },
    });

    for (const row of written) {
      const vector = vectors[row.ordinal];
      if (!vector) throw new Error(`no embedding for ordinal ${row.ordinal}`);
      await tx.$executeRaw`
        UPDATE "document_chunk"
        SET "embedding" = ${`[${vector.join(",")}]`}::vector
        WHERE "id" = ${row.id}
      `;
    }

    await tx.document.update({
      where: { id: document.id },
      data: {
        status: "INDEXED",
        chunkCount: chunks.length,
        lastIndexedAt: new Date(),
        fetchedAt: new Date(),
      },
    });
  });

  return chunks.length;
}

/** Batched so a large document does not build one enormous tensor. The model
 *  is local, so there is no request limit to respect — only memory. */
async function embedAll(inputs: readonly string[]): Promise<number[][]> {
  const out: number[][] = [];

  for (let start = 0; start < inputs.length; start += EMBED_BATCH) {
    out.push(...(await embedDocuments(inputs.slice(start, start + EMBED_BATCH))));
  }

  return out;
}

async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      // A missing root is the common first-run case and deserves a sentence
      // rather than a raw ENOENT stack.
      if (dir === root && (error as { code?: string }).code === "ENOENT") {
        throw new Error(
          `No such directory: ${root}\nCreate it and add .md or .txt files, or pass a path: npm run kb:ingest -- ./some/dir`,
        );
      }
      throw error;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (SUPPORTED.has(extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  }

  await walk(root);
  return found.sort();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
