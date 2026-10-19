import { Base as Model } from '@clyde-api/utils/baseModel'

export default class Patient extends Model {
  id!: string
  first_name!: string
  last_name!: string
  date_of_birth!: string
  phone_number!: string | null
  /** The name the patient goes by on the phone. Caller lookup matches on this, not `first_name`. */
  preferred_name!: string | null
  insurance_member_id!: string | null
  /** Stedi payer id (e.g. '62308' for Cigna). */
  insurance_payer_id!: string | null
  insurance_payer_name!: string | null

  static get tableName() {
    return 'patients'
  }
}
