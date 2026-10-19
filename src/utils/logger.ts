import winston from 'winston'

type Meta = Record<string, unknown>

// Field names that may carry protected health information (PHI). Any log meta key in this set is
// printed as '[PHI]' instead of its value, at any depth. This is the same list production uses:
// HIPAA means a patient's name or date of birth must never land in a log line.
const PHI_FIELDS = new Set([
  'date_of_birth',
  'email',
  'address_street',
  'address_city',
  'address_state',
  'address_zip',
  'phone_number',
  'from_phone_number',
  'callback_number',
  'patient_phone_number',
  'body',
  'transcript',
  'transcript_english',
  'content',
  'raw_answer',
  'caller_name',
  'patient_name',
  'reason_full_text',
  'call_summary',
  'question',
  'question_text',
  'english_question',
  'insurance_name',
  'insurancename',
  'matched_name',
  'matchedname',
  'matched_term',
  'matchedterm',
  'matched_value',
  'matchedvalue',
  'plan_name',
  'planname',
  'filename',
  'file_name',
  'first_name',
  'firstname',
  'last_name',
  'lastname',
  'insurance',
  'member_id',
  'memberid',
  'insurance_member_id',
  'insurancememberid',
  'evidence',
  'evidence_phrase',
  'classification_evidence',
  'values',
  'raw',
  'denial_reason',
  'denialreason',
  'draft',
  'fax_from_number',
  'fax_from_name',
  'fax_to_name',
  'fax_to_number',
  'fax_header_evidence',
  'referring_fax',
  'from_name',
  'to_name',
  'verbatim',
  'line_quote',
  'label_text',
  'transmission_stamp_line',
  // Voice/SMS prompt variables carrying recalled interaction memory: call summaries, patient
  // names, reasons for visit. The assistant-request handler logs the whole variableValues object,
  // so without these the recall block would reach the log sink in full. containerTag embeds the
  // caller's phone number.
  'previouscallmemory',
  'previous_call_memory',
  'priorinteractions',
  'prior_interactions',
  'containertag',
  'container_tag',
  // Payer eligibility (partners/insurance). `date_of_birth` is already covered above, but payers
  // spell it `birth_date`, which was not. `ssn_last_four` is the only place SSN digits exist in
  // this system at all. Defence in depth behind the rule that the VSP client never puts any of
  // these in a log line — this set matches on key NAMES, so it cannot save a value logged under an
  // innocuous key.
  'ssn',
  'ssn_last_four',
  'ssnlastfour',
  'birth_date',
  'birthdate',
  'vsr_number',
  'vsrnumber',
  'class_id',
  'classid',
  'client_name',
  'clientname',
  // Stedi eligibility (insurance verification agent). Stedi's camelCase `dateOfBirth` lowercases to
  // `dateofbirth`, which `date_of_birth` above does not catch. `subscriber` is Stedi's object holding
  // name, DOB, member id and address. `say` is the sentence read to the caller and includes their name.
  'dateofbirth',
  'subscriber',
  'dependents',
  'preferred_name',
  'preferredname',
  'say',
])

const isPhiKey = (key: string) => PHI_FIELDS.has(key.toLowerCase())

const phiReplacer = (key: string, value: unknown) => (isPhiKey(key) ? '[PHI]' : value)

const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitize)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isPhiKey(k) ? '[PHI]' : sanitize(v)
    }
    return out
  }
  return value
}

export const sanitizeMetaForLogging = (obj: Record<string, unknown>): Record<string, unknown> =>
  sanitize(obj) as Record<string, unknown>

// default metadata applied to every log entry
const defaultMeta: Meta = {}

// Production also ships logs to Datadog through a second transport (same PHI redaction applied).
// Here everything goes to the console, which is what Render's log viewer reads.
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaString = Object.keys(meta).length ? JSON.stringify(meta, phiReplacer, 2) : ''
        return `${timestamp} [${level}] ${message} ${metaString}`
      }),
    ),
  }),
]

const coreLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta,
  transports,
  silent: process.env.APP_ENV === 'test',
})

const logger = {
  info(message: string, meta: Meta = {}): void {
    coreLogger.info(message, meta)
  },
  debug(message: string, meta: Meta = {}): void {
    coreLogger.debug(message, meta)
  },
  warn(message: string, meta: Meta = {}): void {
    coreLogger.warn(message, meta)
  },
  error(messageOrError: string | Error, messageOrMeta?: string | Meta, meta: Meta = {}): void {
    if (typeof messageOrError === 'string') {
      // First argument is a string message
      const actualMeta = typeof messageOrMeta === 'object' ? messageOrMeta : meta
      coreLogger.error(messageOrError, actualMeta)
    } else {
      // First argument is an Error object
      const message = typeof messageOrMeta === 'string' ? messageOrMeta : messageOrError.message
      const actualMeta = typeof messageOrMeta === 'string' ? meta : messageOrMeta || {}
      coreLogger.error(message, {
        ...actualMeta,
        error: messageOrError.message,
        stack: messageOrError.stack,
        name: messageOrError.name,
      })
    }
  },
}

export default logger
