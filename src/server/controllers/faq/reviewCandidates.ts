import { z } from 'zod'
import type { RequestContext } from '@clyde-api/types/context'
import type { OpenAIClient } from '@clyde-api/utils/openai'
import type { FaqMatch } from './decide'

export type ReviewDecision =
  | { kind: 'match'; match: FaqMatch; reason: string }
  | { kind: 'clarify'; options: FaqMatch[]; reason: string }
  | { kind: 'none'; reason: string }

const SYSTEM_PROMPT = `You help the phone assistant at an eye clinic answer a patient's question using only the clinic's approved FAQ answers.

You get the patient's question and a few candidate FAQs that were found because their wording is similar. Similar wording does not mean they answer the same question.

Decide one of:
- "match": one candidate's answer actually answers what the patient asked. If several candidates give the same answer, choose the closest one. Put its id in faq_ids.
- "clarify": the question is vague and two or more candidates answer different readings of it, so the assistant should ask which one they mean. Put those ids in faq_ids, most likely first, at most 3.
- "none": no candidate answers the question, even if it is on the same topic. Leave faq_ids empty.

Never write an answer yourself. Give a reason in one short sentence.`

const RESPONSE_JSON_SCHEMA = {
  name: 'faq_review',
  schema: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['match', 'clarify', 'none'] },
      faq_ids: { type: 'array', items: { type: 'string' } },
      reason: { type: 'string' },
    },
    required: ['decision', 'faq_ids', 'reason'],
    additionalProperties: false,
  },
}

const ResponseSchema = z.object({
  decision: z.enum(['match', 'clarify', 'none']),
  faq_ids: z.array(z.string()),
  reason: z.string(),
})

/**
 * The uncertain middle band: similarity found a few plausible FAQs but no clear winner, so an LLM
 * reads the question and the candidates and picks one, asks which, or says none fits.
 *
 * It can only choose between committed answers, never write one. Candidates are shown to it as
 * short ids ("1", "2") and any id it returns that isn't one of them is dropped, so a made-up id can't
 * turn into a made-up answer.
 */
export const reviewCandidates = async (
  question: string,
  candidates: FaqMatch[],
  client: Pick<OpenAIClient, 'chatJson'>,
  ctx: RequestContext,
): Promise<ReviewDecision> => {
  const byShortId = new Map(candidates.map((candidate, i) => [String(i + 1), candidate]))
  const response = await client.chatJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          patient_question: question,
          candidates: [...byShortId].map(([id, c]) => ({ id, question: c.question, answer: c.answer })),
        }),
      },
    ],
    RESPONSE_JSON_SCHEMA,
    ResponseSchema,
    ctx,
  )

  const chosen = [...new Set(response.faq_ids)]
    .map((id) => byShortId.get(id))
    .filter((match): match is FaqMatch => match !== undefined)

  if (response.decision === 'match' && chosen.length > 0) {
    return { kind: 'match', match: chosen[0], reason: response.reason }
  }
  if (response.decision === 'clarify' && chosen.length > 0) {
    // One "option" is still a useful check-back ("are you asking: ...?").
    return { kind: 'clarify', options: chosen.slice(0, 3), reason: response.reason }
  }
  return { kind: 'none', reason: response.reason }
}
