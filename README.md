# clyde-interview-base

> **This is the same setup we run in production at Clyde today.**
> This repo is a trimmed copy of our production API (`clyde-api`). It has the same stack, the same
> folder layout and layering, the same error model, the same logger with PHI redaction, the same
> tooling, and the same deploy model (Docker on Render). We left out a few production-only pieces
> on purpose; see the table below. Nothing here is a toy version of our stack. Code you write in this
> repo would drop into our real codebase following the same patterns, and that's what the interview
> looks at.

| Same as production | Left out here (production-only) |
|---|---|
| Node 22, TypeScript compiled to CommonJS | Temporal workflows and workers |
| Express 5, `asyncHandler`, global error handler | Redis |
| Zod schemas for every request/response | Supabase auth |
| Knex migrations + Objection models on Postgres | GrowthBook feature flags |
| Router → Controller → Model layering | Datadog log shipping |
| `AppError` error model (`code` → HTTP status) | Partner integrations (Twilio, Vapi, EHR connectors) |
| Winston logger with PHI field redaction | Auth middleware and multi-tenant organizations |
| Jest + ts-jest, ESLint + Prettier, Yarn 4 | Staging environment and manual prod promotion |
| Docker image deployed to Render, health-checked on `/healthz` | Supabase-hosted Postgres (Render Postgres here) |

## The assignment

Your task is here:
**[Take-Home: AI Insurance Verification Agent](https://wool-pot-615.notion.site/Take-Home-AI-Insurance-Verification-Agent-3f953aa3160a803eb026cfc22bb6bf65)**

Build your solution on top of this repo. The `patients` feature that ships with it is a worked
example of the pattern: one migration, one model, one controller, one router, one test. It is only a
reference. It does not solve any part of the take-home. Copy its shape for whatever you add.

---

## What I built

A phone agent for an eye clinic, on Vapi, backed by this API on Render. Callers verify who they are,
then ask about their insurance or anything else about the clinic. Clinic staff manage the answers
in a web app built with Lovable. The phone number and the app link are shared separately.

### A call, step by step

1. **"Can I get your first name?"**, then **"And what's your date of birth?"**
2. **`verify_caller`** checks both against Postgres. A wrong name and a wrong birthday get the same
   reply, so the phone line can't be used to find out who's a patient. Birthdays are read however
   they're said: `02/02/1991`, `2/2/91`, "February second, nineteen ninety-one", "the second of
   February", "two, two, one nine nine one" (month first, as in the US).
3. **"How can I help you today?"** The caller leads:
   - Insurance → **`check_insurance`** re-checks the birthday on the server (it never trusts that
     verification ran), runs a real Stedi eligibility check (service type 30), and says whether
     the clinic accepts the plan, whether it's active, and what they'll pay.
   - Anything else → **`answer_question`** answers from the clinic's FAQ list (below).
4. After each answer: "Is there anything else I can help with?" It hangs up only when the caller
   says they're done.

Every tool returns the exact sentence to say. The model reads it out; it never makes up coverage,
prices or policies. The prompt and tool definitions are in
[`docs/vapi/system-prompt.md`](docs/vapi/system-prompt.md).

### Test callers

Stedi's sandbox patients, seeded by a migration:

| Say | Date of birth | Insurance | Expect |
|---|---|---|---|
| James | Feb 2, 1991 | Cigna | Accepted and active: "you're all set", 10% after a $250 deductible |
| Jane | May 5, 1975 | Humana | Active, but not accepted: self-pay options |
| Morgan | Jan 1, 1971 | UnitedHealthcare | Accepted, but inactive (the plan is under the name Jane Doe) |

### Answering questions from the FAQ list

250 hypothetical FAQs (generated with AI for this take-home) are seeded into a `faqs` table.

1. **Store.** Each FAQ question is embedded with OpenAI `text-embedding-3-small` and stored in a
   pgvector column. New and edited FAQs are embedded on save; anything missed is picked up on
   startup or with `POST /faqs/reindex`.
2. **Search.** A caller's question is embedded the same way, and pgvector ranks the FAQs by cosine
   similarity (1 = same meaning).
3. **Decide** (`src/server/controllers/faq/decide.ts`, thresholds in `src/config/faq.ts`):

| Top match | What the agent does |
|---|---|
| ≥ 0.80 and clearly ahead of #2 | Reads that FAQ's answer word for word. No LLM call. |
| 0.50 to 0.80, or two close matches with different answers | `gpt-4.1-mini` looks at the closest FAQs (up to 4) and picks one, asks the caller which they meant, or says none fits. It can only choose between committed answers, never write one. If it's down, the agent asks the caller instead of guessing. |
| < 0.50 | "I don't have an answer to that one." The question goes to the clinic's inbox. |

4. **Learn.** Every question is recorded in `caller_questions`. Unanswered ones are the clinic's
   inbox: answering one adds it as an FAQ, and the agent can answer it on the next call.

**Thresholds are measured, not guessed.** `yarn faqs:eval` runs 87 labeled questions (60
paraphrases, 7 vague, 20 off-topic) against the real embeddings and sweeps the thresholds; `--full`
runs the whole pipeline with the LLM. At the chosen settings the similarity step answers nothing
with the wrong FAQ (my first guess, 0.75, did that 4 times), and end to end: 58 of 60 paraphrases
answered correctly (one more got the right fact from a neighbouring FAQ; "where is the clinic"
missed, see below), all 7 vague questions clarified or answered sensibly, and all 20 off-topic
questions declined. Embedding question + answer together ranked the
right FAQ first more often, but wasn't better end to end and sent more questions to the slower LLM
step, so FAQs are embedded by question only.

**Why pgvector and not mem0:** the FAQs are the clinic's exact, approved wording, edited by staff,
so they belong in a table the clinic controls. mem0 would fit caller memory instead (e.g. "new
insurance card coming"), recalled only after verification.

### The clinic app (Lovable)

A single page app for clinic staff, built with Lovable and talking only to this API: browse, search,
add, edit, turn off and delete FAQs; import or export a CSV; **test a question** to see the matches,
scores and what the agent would say; and work through the **inbox** of questions the agent couldn't
answer. It asks for the admin key on first load and keeps it in the browser, not in the app's code.

### API

| Route | Auth | What it does |
|---|---|---|
| `POST /vapi/tools` | `x-vapi-secret` | Vapi's tool server: `verify_caller`, `check_insurance`, `answer_question` |
| `POST /eligibility/check` | `x-vapi-secret` | `check_insurance` without the Vapi envelope, for curl |
| `GET /faqs` | admin key | List, with `search`, `category`, `active` filters |
| `POST /faqs`, `PATCH /faqs/:id`, `DELETE /faqs/:id` | admin key | Manage FAQs (edits re-embed) |
| `POST /faqs/import` | admin key | Bulk load, `mode: append` (skips duplicates) or `replace` |
| `POST /faqs/test` | admin key | Runs the agent's answer and explains it. Records nothing. |
| `POST /faqs/reindex` | admin key | Embeds any FAQ that isn't searchable yet |
| `GET /caller-questions` | admin key | What callers asked; `outcome=unanswered&status=open` is the inbox |
| `POST /caller-questions/:id/resolve` | admin key | Answer an inbox question by adding it as an FAQ |
| `PATCH /caller-questions/:id` | admin key | Dismiss (or reopen) an inbox question |

The admin key is `Authorization: Bearer <ADMIN_API_KEY>`, separate from the Vapi secret. Browser
calls are allowed from `CORS_ORIGINS` (`https://*.lovable.app`, `https://*.lovableproject.com`).

### Configuration

| Variable | Used for |
|---|---|
| `STEDI_API_KEY` | Stedi eligibility checks (test-mode key) |
| `VAPI_TOOL_SECRET` | Shared secret on the Vapi tools |
| `OPENAI_API_KEY` | Embeddings and the uncertain-match step |
| `ADMIN_API_KEY` | The clinic app's API key |
| `USE_CORS`, `CORS_ORIGINS` | Let the Lovable app call the API from the browser |
| `OPENAI_CHAT_MODEL`, `FAQ_ANSWER_AT`, `FAQ_CONSIDER_FROM`, `FAQ_MARGIN` | Optional overrides |

Without `VAPI_TOOL_SECRET` or `ADMIN_API_KEY`, production refuses those routes and development lets
them through. Logs hold ids, never names, birthdays or caller questions; questions are stored only
in `caller_questions`.

### Running it locally

Same quickstart as below. The local Postgres image is `pgvector/pgvector:pg17`. Add your keys to
`.env` (see `.env.example`); with `OPENAI_API_KEY` set, the server embeds the seeded FAQs on startup.

| Command | What it checks |
|---|---|
| `yarn test` | Unit tests. No database or network needed. |
| `yarn test:db` | pgvector search, FAQ edits and the inbox against the real test Postgres (`yarn db:up` first) |
| `yarn faqs:eval` / `yarn faqs:eval --full` | Threshold sweep / full pipeline on the 87 labeled questions (uses OpenAI) |

### What I'd do next

- **Alternate phrasings per FAQ.** "Where is the clinic?" misses "Where are you located?" because
  the wording barely overlaps. Staff should be able to attach a caller's wording to an existing FAQ
  from the inbox instead of adding a duplicate.
- **Real logins for the clinic app** instead of one shared admin key, with a clinic per account.
- **Live transfer** to the front desk instead of "the front desk will follow up".
- **Monitoring** on check failures, unanswered rates and latency, plus caller memory (mem0) once
  verification is in place.

---

## Prerequisites

- **Node 22**: `nvm use` picks it up from `.nvmrc`
- **Corepack**: run `corepack enable` once. It installs the Yarn version pinned in `package.json`, so
  you don't install Yarn yourself.
- **Docker Desktop**, *running*. It provides the local Postgres.

## Quickstart (about 5 minutes)

```bash
yarn                       # install dependencies
cp .env.example .env       # local config (defaults already match docker-compose)
yarn db:up                 # start Postgres 17 + pgvector in Docker on :2534
yarn migrate               # create the tables
yarn dev                   # compile + run, restarting on every save
```

Then:

```bash
curl localhost:4000/healthz
# {"status":"ok","database":{"reachable":true,...}}

curl -X POST localhost:4000/patients \
  -H 'content-type: application/json' \
  -d '{"first_name":"Ada","last_name":"Lovelace","date_of_birth":"1990-12-10","phone_number":"+15555550123"}'

curl localhost:4000/patients
```

## How the code is organized

```
src/
  index.ts                       entry: load .env → register aliases → connect DB → listen
  config/init.ts                 connects services at startup (only Postgres here)
  server/
    index.ts                     Express app: middleware, routers, global error handler
    routers/<domain>.ts          HTTP layer: validate with Zod, build ctx, call controller, res.json()
    controllers/<domain>/
      XController.ts             business logic: no req/res, no status codes; throws AppError
      schemas.ts                 Zod schemas for params and results
    middleware/                  request id, etc.
  models/<table>.ts              Objection models
  types/errors.ts                AppError + helpers (notFound, validation, conflict, ...)
  utils/                         logger, database, asyncHandler, env, cors
migrations/                      Knex migrations (plain JS)
tests/                           Jest tests, mirroring src/
```

A request flows like this:

```
HTTP request
  → router          parse(Schema, req.body)  → 400 validation_error if invalid
  → controller      pure logic, talks to models, throws AppError.notFound(...) etc.
  → model           Objection query against Postgres
  ← router          res.json({ ... })
  ↳ on any throw    global error handler maps err.code → status, logs it, returns { error, code, requestId }
```

**Rules we hold in production (and here):**

1. **Thin routers, pure controllers.** Routers do validation and HTTP. Controllers never import
   Express and never pick status codes.
2. **Zod for every contract.** Request shapes live in `controllers/<domain>/schemas.ts`.
3. **Errors are `AppError`s.** Throw `AppError.notFound(...)`, `AppError.validation(...)` and so
   on. The global handler in `src/server/index.ts` turns `code` into a status.
4. **Schema changes are migrations.** Never change tables by hand. Run `yarn migrate:make <name>`.
5. **Use the logger, and log ids rather than people.** `@clyde-api/utils/logger` replaces any field
   named in `PHI_FIELDS` (names, dates of birth, phone numbers, insurance member ids, ...) with
   `[PHI]` before it prints. That's a HIPAA requirement in production.

**Import aliases.** `@clyde-api/*` maps to `src/*` at compile time (`tsconfig.json` `paths`) and to
`dist/*` at runtime (`_moduleAliases` in `package.json`). If you add a new top-level folder under
`src/`, add it to **both** lists.

## Adding an endpoint (follow the patients example)

1. **Migration:** `yarn migrate:make create_widgets`, then edit the new file in `migrations/` and run
   `yarn migrate`.
2. **Model:** `src/models/widget.ts`, extending `Base` from `@clyde-api/utils/baseModel`.
3. **Schemas:** `src/server/controllers/widget/schemas.ts`, with Zod schemas for the body, params
   and result.
4. **Controller:** `src/server/controllers/widget/WidgetController.ts`. Export a class and a
   singleton, and take a `ctx: RequestContext` as the last argument.
5. **Router:** `src/server/routers/widgets.ts`. Validate, call the controller, respond. Mount it in
   `src/server/routers/index.ts`.
6. **Test:** `tests/controllers/widget/WidgetController.test.ts`.

## Commands

| Command | What it does |
|---|---|
| `yarn dev` | Watch mode: recompiles `src/` into `dist/` and restarts on each save |
| `yarn build` / `yarn start` | One-off compile / run the compiled app |
| `yarn test` | Unit tests (Jest). Run one file: `yarn test -- tests/controllers/patient` |
| `yarn test:db` | Database tests against the throwaway test Postgres (pgvector search, FAQs, inbox) |
| `yarn faqs:eval` | Measure FAQ routing on labeled questions; `--full` includes the LLM step |
| `yarn typecheck` | Type-check `src/` **and** `tests/` |
| `yarn lint` | ESLint + Prettier. Fix formatting with `yarn prettier --write "src/**/*.ts"` |
| `yarn migrate` / `yarn migrate:down` | Apply / roll back migrations |
| `yarn migrate:make <name>` | New migration file |
| `yarn db:up` / `yarn db:down` | Start / stop local Postgres (`:2534`, plus a throwaway test DB on `:5433`) |

---

## Deploying (Render)

Production runs on Render, and so does this repo. Everything Render needs is declared in
`render.yaml` (the "Blueprint"), so there should be nothing to configure by hand.

### First deploy (about 15 minutes, mostly waiting for the build)

1. **Push the repo to GitHub.** Use your own copy, either a fork or a new repo.
2. Create a free account at [render.com](https://render.com) and connect your GitHub account.
3. In Render, click **New → Blueprint** and pick the repo. Render reads `render.yaml` and shows two
   resources:
   - `interview-db`, a Postgres 17 database
   - `clyde-interview-api`, a web service built from the `Dockerfile`
4. Click **Apply**. Render creates the database, injects its connection string as `DB_URL`, builds
   the Docker image and starts it. On start the container runs `knex migrate:latest` and then the
   API.
5. When the service shows **Live**, open its URL:
   ```bash
   curl https://<your-service>.onrender.com/healthz
   ```

### After that

- **Every push to `main` deploys automatically** (`autoDeployTrigger: commit` in `render.yaml`).
  `.github/workflows/ci.yml` runs lint, typecheck, tests, build and a Docker build, but the deploy
  doesn't wait for it, so run `yarn lint && yarn typecheck && yarn test` before pushing.
- **Migrations run on every deploy**, before the server starts. Commit a new migration file and push.
- **Logs:** go to the service, then **Logs**. This is the same logger output you see locally.
- **Environment variables and secrets:** go to the service, then **Environment**. Add them there,
  never in the repo. To make a new variable part of the Blueprint, add it to `render.yaml` with
  `sync: false` so Render prompts for the value.
- **Roll back:** go to the service, then **Events**, and pick an earlier deploy, then **Rollback**.
  Migrations don't roll back automatically. Run `node_modules/.bin/knex migrate:down` from the
  service's **Shell** tab if you need to (Shell is only on paid plans).
- **Connect to the database:** go to `interview-db`, then **Connect**, and copy the *External*
  connection string into `psql` or a GUI.

### Free-tier caveats

- A free web service sleeps after 15 minutes without traffic, and the first request after that takes
  about a minute. That's fine for a demo. Hit `/healthz` before you show it to someone.
- A free Render Postgres database **expires after 30 days**. Upgrade it, or re-create it from the
  Blueprint.
- `preDeployCommand` (running migrations as a separate step before traffic switches) needs a paid
  instance. That's why the Dockerfile runs migrations at container start.

### Test the production image locally (optional)

```bash
docker build -t clyde-interview-api .
docker run --rm -p 4000:4000 \
  -e DB_URL=postgres://interview:interview@host.docker.internal:2534/interview \
  -e DB_SSL=false \
  clyde-interview-api
```

---

## Troubleshooting

**`Could not connect to Postgres at localhost:2534. Nothing is listening there.`**
Postgres isn't running. Start Docker Desktop, then run `yarn db:up`. Check it with `docker compose ps`.

**`port 5432 is already allocated` on `yarn db:up`**
Another Postgres is already using the port (often a Homebrew one: `brew services stop postgresql@17`).
Either stop it, or change the left-hand port in `docker-compose.yml` and set `DB_PORT` in `.env` to
match.

**`Cannot find module '@clyde-api/...'` at runtime, but it compiles**
You added a folder under `src/` and listed it in `tsconfig.json` `paths` but not in `_moduleAliases`
in `package.json`, or the other way round. Add it to both.

**`This project is configured to use yarn@4.9.4` / wrong Yarn version**
Run `corepack enable`. Don't install Yarn globally with npm.

**Render deploy fails on `yarn install --immutable`**
`yarn.lock` is out of date. Run `yarn` locally and commit the lockfile.
