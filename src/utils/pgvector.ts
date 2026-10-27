import { raw } from 'objection'

/**
 * Knex has no pgvector operators, so these are the same one-line fragments the official `pgvector`
 * package builds (that package is ESM-only, which Jest's CommonJS runtime can't load). Values are
 * always bound, never interpolated.
 */

/** pgvector's text format, '[0.1,0.2,...]'. Postgres casts it when written to a vector column. */
export const toSql = (vector: number[]): string => `[${vector.join(',')}]`

/** Cosine distance between a vector column and `vector`: 0 = same direction, 2 = opposite. */
export const cosineDistance = (column: string, vector: number[]) => raw('?? <=> ?::vector', [column, toSql(vector)])

/** Cosine similarity (1 minus distance), selected under `alias`. */
export const cosineSimilarity = (column: string, vector: number[], alias: string) =>
  raw('1 - (?? <=> ?::vector) AS ??', [column, toSql(vector), alias])
