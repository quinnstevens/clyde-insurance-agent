import { faqController } from '@clyde-api/server/controllers/faq/FaqController'
import { connectDb } from '@clyde-api/utils/database'
import logger from '@clyde-api/utils/logger'

export interface InitOptions {
  name: string
}

// Production also connects Redis, Twilio, Supabase and GrowthBook here, each behind an option flag.
// Add new services the same way: connect them here, not at import time.
export const initServices = async (options: InitOptions) => {
  const { name } = options

  await connectDb()

  // Embed seeded or edited FAQs in the background, so a fresh database becomes searchable without
  // holding up startup (Render's health check is waiting).
  faqController
    .embedPending({ requestId: `${name}-startup` })
    .then((result) => logger.info(`[${name}] FAQ embeddings checked`, result))
    .catch((error) => logger.error(error, `[${name}] FAQ embedding on startup failed`))

  logger.info(`[${name}] Services initialized`)
}
