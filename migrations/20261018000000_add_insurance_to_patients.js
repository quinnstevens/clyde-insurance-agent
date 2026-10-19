/**
 * Insurance on file for each patient, plus the name callers actually say on the phone.
 *
 * `first_name`/`last_name` stay the legal names the payer has on record, because Stedi only matches
 * when they are exact. `preferred_name` is what the voice agent hears ("Morgan") and is the only
 * column caller lookup uses.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('patients', (table) => {
    table.string('preferred_name')
    table.string('insurance_member_id')
    table.string('insurance_payer_id')
    table.string('insurance_payer_name')
    table.index(['preferred_name'])
  })
}

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async (knex) => {
  await knex.schema.alterTable('patients', (table) => {
    table.dropIndex(['preferred_name'])
    table.dropColumn('preferred_name')
    table.dropColumn('insurance_member_id')
    table.dropColumn('insurance_payer_id')
    table.dropColumn('insurance_payer_name')
  })
}
