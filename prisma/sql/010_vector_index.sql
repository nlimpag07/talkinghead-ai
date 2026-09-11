-- HNSW over cosine distance. Chosen over IVFFlat because IVFFlat needs
-- representative data present at build time to pick list counts, and this
-- table starts empty.
--
-- m/ef_construction are build-time cost vs. recall. These defaults are right
-- for a few thousand chunks; revisit only if recall measurably suffers.
CREATE INDEX IF NOT EXISTS "document_chunk_embedding_hnsw"
  ON "document_chunk"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Retrieval filters by knowledge base before ranking, so the join column
-- needs to be cheap.
CREATE INDEX IF NOT EXISTS "document_chunk_document_id_idx"
  ON "document_chunk" ("documentId");
