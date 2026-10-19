import { Router } from 'express'
import { patientController } from '@clyde-api/server/controllers/patient/PatientController'
import {
  CreatePatientBodySchema,
  ListPatientsQuerySchema,
  PatientIdParamsSchema,
} from '@clyde-api/server/controllers/patient/schemas'
import { asyncHandler } from '@clyde-api/utils/asyncHandler'
import { parse } from '@clyde-api/utils/validate'

const router = Router()

/**
 * GET /patients?limit=50
 * Most recently created first.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const query = parse(ListPatientsQuerySchema, req.query, ctx.requestId)

    const patients = await patientController.list(query, ctx)
    res.json({ patients })
  }),
)

/**
 * GET /patients/:id
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const { id } = parse(PatientIdParamsSchema, req.params, ctx.requestId)

    const patient = await patientController.get(id, ctx)
    res.json({ patient })
  }),
)

/**
 * POST /patients
 * Body: { first_name, last_name, date_of_birth: 'YYYY-MM-DD', phone_number?: E.164 }
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const body = parse(CreatePatientBodySchema, req.body, ctx.requestId)

    const patient = await patientController.create(body, ctx)
    res.status(201).json({ patient })
  }),
)

export default router
