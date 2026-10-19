import type { ZodType } from 'zod'
import { AppError } from '@clyde-api/types/errors'

/** Parse `input` with `schema`, or throw a 400 that names the first bad field. */
export const parse = <T>(schema: ZodType<T>, input: unknown, requestId?: string): T => {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw AppError.validation(issue.message, { requestId, path: issue.path.join('.') })
  }
  return result.data
}
