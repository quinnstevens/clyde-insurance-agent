/**
 * Measures how well the FAQ agent routes realistic caller questions, to pick the similarity
 * thresholds in src/config/faq.ts from data instead of guessing.
 *
 *   yarn faqs:eval          similarity only: sweeps thresholds and ranks them (cheap, no LLM)
 *   yarn faqs:eval --full   the whole pipeline, LLM included, at the configured thresholds
 *
 * Uses the local database (yarn db:up && yarn migrate) and OPENAI_API_KEY from .env. Cases live in
 * scripts/data/faq-eval.json: paraphrases with the FAQ they should hit, vague questions with the
 * FAQs that would be fair to offer, and questions the list can't answer.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FAQ_THRESHOLDS, type FaqThresholds } from '@clyde-api/config/faq'
import { FaqAnswerController } from '@clyde-api/server/controllers/faq/FaqAnswerController'
import { FaqController } from '@clyde-api/server/controllers/faq/FaqController'
import { decideBySimilarity, type FaqMatch } from '@clyde-api/server/controllers/faq/decide'
import { faqStore } from '@clyde-api/server/controllers/faq/faqStore'
import { closeDb, connectDb } from '@clyde-api/utils/database'
import { openai } from '@clyde-api/utils/openai'

interface EvalCases {
  paraphrases: { question: string; expected: string }[]
  ambiguous: { question: string; acceptable: string[] }[]
  off_topic: { question: string }[]
}

type Kind = 'paraphrase' | 'ambiguous' | 'off_topic'
interface Case {
  kind: Kind
  question: string
  acceptable: string[]
  matches: FaqMatch[]
}

const ctx = { requestId: 'faq-eval' }
const pct = (n: number, d: number) => `${Math.round((100 * n) / Math.max(d, 1))}%`.padStart(4)

const loadCases = async (): Promise<Case[]> => {
  const raw = JSON.parse(readFileSync(resolve(__dirname, 'data/faq-eval.json'), 'utf8')) as EvalCases
  const cases: Omit<Case, 'matches'>[] = [
    ...raw.paraphrases.map((c) => ({ kind: 'paraphrase' as const, question: c.question, acceptable: [c.expected] })),
    ...raw.ambiguous.map((c) => ({ kind: 'ambiguous' as const, question: c.question, acceptable: c.acceptable })),
    ...raw.off_topic.map((c) => ({ kind: 'off_topic' as const, question: c.question, acceptable: [] })),
  ]
  const vectors = await openai.embed(
    cases.map((c) => c.question),
    ctx,
  )
  return Promise.all(cases.map(async (c, i) => ({ ...c, matches: await faqStore.search(vectors[i]) })))
}

/**
 * Lower is better. A confident wrong answer is the worst outcome (5), a caller who gets "I don't
 * know" for something on the list is next (2), and an LLM review costs a little latency (0.3).
 */
const score = (cases: Case[], thresholds: FaqThresholds) => {
  const tally = { right: 0, wrong: 0, review: 0, missed: 0, offAnswered: 0, offReview: 0, cost: 0 }
  for (const c of cases) {
    const decision = decideBySimilarity(c.matches, thresholds)
    if (c.kind === 'off_topic') {
      if (decision.kind === 'answer') (tally.offAnswered++, (tally.cost += 5))
      if (decision.kind === 'review') (tally.offReview++, (tally.cost += 0.3))
      continue
    }
    if (decision.kind === 'answer') {
      const ok = c.acceptable.includes(decision.match.question)
      if (ok) tally.right++
      else (tally.wrong++, (tally.cost += 5))
    } else if (decision.kind === 'review') {
      tally.review++
      tally.cost += 0.3
      // Review can only pick a candidate it was shown.
      if (!decision.candidates.some((m) => c.acceptable.includes(m.question))) tally.cost += 2
    } else {
      tally.missed++
      tally.cost += 2
    }
  }
  return tally
}

const sweep = (cases: Case[]) => {
  const onList = cases.filter((c) => c.kind !== 'off_topic').length
  const off = cases.length - onList
  const rows: { t: FaqThresholds; s: ReturnType<typeof score> }[] = []
  for (let answerAt = 0.55; answerAt <= 0.951; answerAt += 0.025) {
    for (let considerFrom = 0.3; considerFrom <= answerAt; considerFrom += 0.025) {
      for (const margin of [0.02, 0.05, 0.08]) {
        const t = { answerAt: +answerAt.toFixed(3), considerFrom: +considerFrom.toFixed(3), margin }
        rows.push({ t, s: score(cases, t) })
      }
    }
  }
  rows.sort((a, b) => a.s.cost - b.s.cost)

  console.log(`\n${onList} on-list questions, ${off} off-topic. Best thresholds by cost:\n`)
  console.log('answerAt considerFrom margin | right wrong review missed | off: answered review | cost')
  for (const { t, s } of rows.slice(0, 12)) {
    console.log(
      `${t.answerAt.toFixed(3).padStart(8)} ${t.considerFrom.toFixed(3).padStart(12)} ${t.margin.toFixed(2).padStart(6)} |` +
        ` ${pct(s.right, onList)} ${pct(s.wrong, onList)}  ${pct(s.review, onList)}   ${pct(s.missed, onList)} |` +
        `      ${pct(s.offAnswered, off)}   ${pct(s.offReview, off)} | ${s.cost.toFixed(1)}`,
    )
  }
  const current = score(cases, FAQ_THRESHOLDS)
  console.log(`\nConfigured ${JSON.stringify(FAQ_THRESHOLDS)} -> cost ${current.cost.toFixed(1)}`, current)
}

const scoresByKind = (cases: Case[]) => {
  console.log('\nTop similarity by kind (min / median / max):')
  for (const kind of ['paraphrase', 'ambiguous', 'off_topic'] as Kind[]) {
    const tops = cases
      .filter((c) => c.kind === kind)
      .map((c) => c.matches[0]?.similarity ?? 0)
      .sort((a, b) => a - b)
    const at = (q: number) => tops[Math.floor(q * (tops.length - 1))].toFixed(3)
    console.log(`  ${kind.padEnd(10)} ${at(0)} / ${at(0.5)} / ${at(1)}`)
  }
}

const full = async (cases: Case[]) => {
  const answerer = new FaqAnswerController()
  const tally: Record<string, number> = {}
  const problems: string[] = []
  for (const c of cases) {
    const result = await answerer.answer({ question: c.question }, { record: false }, ctx)
    const offered = result.outcome === 'answered' ? [result.faq_id] : result.options.map((o) => o.faq_id)
    const offeredQuestions = c.matches.filter((m) => offered.includes(m.id)).map((m) => m.question)
    const ok =
      c.kind === 'off_topic'
        ? result.outcome === 'unanswered'
        : result.outcome !== 'unanswered' && offeredQuestions.some((q) => c.acceptable.includes(q))
    const key = `${c.kind} ${result.outcome} ${ok ? 'ok' : 'WRONG'}`
    tally[key] = (tally[key] ?? 0) + 1
    if (!ok) problems.push(`  [${c.kind}] "${c.question}" -> ${result.outcome} (${result.decided_by}): ${result.say}`)
  }
  console.log('\nFull pipeline at configured thresholds:')
  for (const [key, n] of Object.entries(tally).sort()) console.log(`  ${key.padEnd(32)} ${n}`)
  if (problems.length) console.log(`\nNot ok:\n${problems.join('\n')}`)
}

const main = async () => {
  await connectDb()
  const pending = await new FaqController().embedPending(ctx)
  if (pending.embedded) console.log(`Embedded ${pending.embedded} FAQs first.`)

  const cases = await loadCases()
  scoresByKind(cases)
  if (process.argv.includes('--full')) await full(cases)
  else sweep(cases)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => closeDb())
