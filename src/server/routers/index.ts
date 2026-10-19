import { Router } from 'express'

import healthcheckRouter from '@clyde-api/server/routers/healthcheck'
import patientsRouter from '@clyde-api/server/routers/patients'
import eligibilityRouter from '@clyde-api/server/routers/eligibility'
import vapiRouter from '@clyde-api/server/routers/vapi'

const router = Router()

router.use('/healthz', healthcheckRouter)
router.use('/patients', patientsRouter)
router.use('/eligibility', eligibilityRouter)
router.use('/vapi', vapiRouter)

export default router
