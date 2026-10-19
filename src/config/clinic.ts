/**
 * Facts about the clinic itself that eligibility checks depend on.
 */
export const CLINIC_PROVIDER = {
  organizationName: 'Clyde Eye Clinic',
  // Stedi's sandbox accepts this test NPI for every mock patient.
  npi: '1999999984',
}

/** 30 = Health Benefit Plan Coverage: the general "is this plan active and what does it cost" check. */
export const ELIGIBILITY_SERVICE_TYPE_CODE = '30'

/**
 * Insurance plans this clinic accepts, keyed by Stedi payer id.
 *
 * Stedi reports whether a patient's coverage is active; it has no idea which payers a clinic takes,
 * so that list lives here. Match on payer id, never on name: the same payer comes back under
 * different names (Cigna's sandbox responses say "CHLIC").
 */
export const ACCEPTED_PAYERS: Readonly<Record<string, string>> = {
  '60054': 'Aetna',
  '62308': 'Cigna',
  '87726': 'UnitedHealthcare',
}

export const isAcceptedPayer = (payerId: string): boolean => Object.hasOwn(ACCEPTED_PAYERS, payerId)

/** "Aetna, Cigna, or UnitedHealthcare", for the agent to read out. */
export const acceptedPayerList = (): string => {
  const names = Object.values(ACCEPTED_PAYERS)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}`
}
