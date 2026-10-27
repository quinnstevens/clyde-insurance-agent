/**
 * The clinic's starting FAQ list: 250 hypothetical questions and answers for Clyde Eye Clinic,
 * written with AI for this take-home (the clinic's real list would be imported through the API).
 * Embeddings are added by the server on startup, so this migration needs no API key.
 */
const FAQS = require('./data/clinic-faqs.json')

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async (knex) => {
  await knex('faqs').insert(FAQS.map(({ question, answer, category }) => ({ question, answer, category })))
}

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async (knex) => {
  await knex('faqs')
    .whereIn(
      'question',
      FAQS.map((faq) => faq.question),
    )
    .delete()
}
