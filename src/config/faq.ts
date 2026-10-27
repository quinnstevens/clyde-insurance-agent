/**
 * How the agent decides what to do with a caller's question, by cosine similarity between the
 * question's embedding and each FAQ question's embedding (1 = same meaning, 0 = unrelated).
 *
 *   similarity >= answerAt, and clearly ahead of #2  ->  read that FAQ's answer
 *   considerFrom <= similarity, otherwise           ->  an LLM picks among the close FAQs, or asks
 *   below considerFrom                              ->  "I don't know", logged for the clinic
 *
 * The numbers are tuned with `yarn faqs:eval` against paraphrased and off-topic questions, not
 * guessed. They can be overridden per environment without a deploy.
 */
const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && process.env[name] !== '' ? value : fallback
}

export const FAQ_THRESHOLDS = {
  answerAt: numberFromEnv('FAQ_ANSWER_AT', 0.8),
  considerFrom: numberFromEnv('FAQ_CONSIDER_FROM', 0.5),
  /** How far #1 must be ahead of #2 to skip the LLM when both are above `answerAt`. */
  margin: numberFromEnv('FAQ_MARGIN', 0.08),
}

export type FaqThresholds = typeof FAQ_THRESHOLDS

/** How many nearest FAQs to pull, and how many of them the LLM may choose between. */
export const FAQ_SEARCH_LIMIT = 5
export const FAQ_MAX_CANDIDATES = 4

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini'
