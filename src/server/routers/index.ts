import { Router } from 'express'

import healthcheckRouter from '@clyde-api/server/routers/healthcheck'
import patientsRouter from '@clyde-api/server/routers/patients'
import eligibilityRouter from '@clyde-api/server/routers/eligibility'
import vapiRouter from '@clyde-api/server/routers/vapi'
import faqsRouter from '@clyde-api/server/routers/faqs'
import callerQuestionsRouter from '@clyde-api/server/routers/callerQuestions'

const router = Router()

router.use('/healthz', healthcheckRouter)
router.use('/patients', patientsRouter)
router.use('/eligibility', eligibilityRouter)
router.use('/vapi', vapiRouter)
router.use('/faqs', faqsRouter)
router.use('/caller-questions', callerQuestionsRouter)

export default router
