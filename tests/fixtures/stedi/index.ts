import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EligibilityResponseSchema, type EligibilityResponse } from '@clyde-api/utils/stedi'

/**
 * Real Stedi sandbox responses (test mode, service type 30, NPI 1999999984), recorded 2026-10-18.
 * - james:  Cigna (62308), active, Open Access Plus
 * - jane:   Humana (61101), active, Humana Gold Plan
 * - morgan: UnitedHealthcare (87726), member UHCINACTIVE, inactive
 */
export type StediFixture = 'james' | 'jane' | 'morgan'

export const loadStediFixture = (name: StediFixture): EligibilityResponse =>
  EligibilityResponseSchema.parse(JSON.parse(readFileSync(join(__dirname, `${name}.json`), 'utf8')))
