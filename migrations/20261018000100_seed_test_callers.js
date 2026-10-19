/**
 * The three callers the reviewers will phone in as. Each maps to one of Stedi's sandbox mock
 * patients, whose name, date of birth and member id must match exactly. These are Stedi's published
 * test identities, not real people.
 *
 * Note "Morgan" is on file with the payer as Jane Doe: the spoken name is only a key into our records.
 */
const TEST_CALLERS = [
  {
    preferred_name: 'James',
    first_name: 'James',
    last_name: 'Jones',
    date_of_birth: '1991-02-02',
    insurance_member_id: '23456789100',
    insurance_payer_id: '62308',
    insurance_payer_name: 'Cigna',
  },
  {
    preferred_name: 'Jane',
    first_name: 'Jane',
    last_name: 'Doe',
    date_of_birth: '1975-05-05',
    insurance_member_id: 'HUMANA123',
    insurance_payer_id: '61101',
    insurance_payer_name: 'Humana',
  },
  {
    preferred_name: 'Morgan',
    first_name: 'Jane',
    last_name: 'Doe',
    date_of_birth: '1971-01-01',
    insurance_member_id: 'UHCINACTIVE',
    insurance_payer_id: '87726',
    insurance_payer_name: 'UnitedHealthcare',
  },
]

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async (knex) => {
  await knex('patients').insert(TEST_CALLERS)
}

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async (knex) => {
  await knex('patients')
    .whereIn(
      'insurance_member_id',
      TEST_CALLERS.map((caller) => caller.insurance_member_id),
    )
    .delete()
}
