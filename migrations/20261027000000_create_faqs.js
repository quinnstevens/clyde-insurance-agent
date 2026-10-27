/**
 * The clinic's approved questions and answers, plus every question callers ask the agent.
 *
 * `embedding` is the OpenAI text-embedding-3-small vector of `question` (1536 dimensions). It is
 * filled in by the server, not here, so it is null until the server has embedded the row.
 * `embedded_question` records which text the vector came from, so an edited question gets re-embedded.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async (knex) => {
  await knex.schema.createExtensionIfNotExists('vector')

  await knex.schema.createTable('faqs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.text('question').notNullable()
    table.text('answer').notNullable()
    table.string('category')
    table.boolean('active').notNullable().defaultTo(true)
    table.specificType('embedding', 'vector(1536)')
    table.text('embedded_question')
    table.integer('times_used').notNullable().defaultTo(0)
    table.timestamp('last_used_at', { useTz: true })
    table.timestamps(true, true)
  })
  // Cosine distance index. With a few hundred rows Postgres would scan anyway, but this keeps
  // search fast as the list grows.
  await knex.raw('CREATE INDEX faqs_embedding_idx ON faqs USING hnsw (embedding vector_cosine_ops)')

  // Every question the agent was asked, and what it did with it. Unanswered ones are the clinic's
  // inbox: each is a gap in the FAQ list. `question` may contain health details, so it lives here
  // and never in logs.
  await knex.schema.createTable('caller_questions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.text('question').notNullable()
    table.string('outcome').notNullable() // answered | clarify | unanswered
    table.string('decided_by').notNullable() // similarity | llm | fallback
    table.uuid('faq_id').references('faqs.id').onDelete('SET NULL')
    table.float('top_similarity')
    table.text('reason')
    table.string('status') // unanswered only: open | resolved | dismissed
    table.uuid('resolved_faq_id').references('faqs.id').onDelete('SET NULL')
    table.string('call_id')
    table.timestamps(true, true)
  })
  await knex.raw('CREATE INDEX caller_questions_inbox_idx ON caller_questions (outcome, status, created_at DESC)')
}

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTable('caller_questions')
  await knex.schema.dropTable('faqs')
}
