# Requirements: recipe-reader

## Why

This is the only place in Make Dinner where a language model is used. The cook pastes
recipe prose and gets a `Plan` back, which they can check and edit before anything is
scheduled. The model is useful and untrusted: it costs money, it can fail, refuse or
return nonsense, and the text it reads comes from strangers. So the route that calls it has
to answer the built-in samples without it, limit how often it is called, never leak the
key, and pass everything it returns through the same schema and sanity rules as every
other plan source.

## Scope

In `src/server` (Node, see `tech.md` and `structure.md`):

- `GET /api/samples`: the built-in sample dinners, each with its text, its recorded plan,
  a suggested kitchen and serving time, in one response.
- `POST /api/parse { text }`: recipe text to `{ plan, issues, source }`, in the order of
  checks that `tech.md` fixes.
- The model call in `src/server/parse/`: the Anthropic TypeScript SDK, model
  `claude-opus-5-5`, structured output against a JSON schema derived from `PlanSchema`.
- The prompt, written out in full in the design.
- The per-IP rate limit and the daily cap, in memory.
- Recordings: `recordings/<sample-id>.json`, `npm run record` (`scripts/record.ts`), and the
  startup check that every sample has a current recording.
- `samples/index.json`: the list of sample dinners.

In `test/`: the hand-made fixture under `test/fixtures/not-a-recording/`, fakes for the
model client, the Anthropic HTTP endpoint and the clock, and the generators for the
properties in this spec.

Terms are the glossary in `product.md`. "Recording" means a file in `recordings/` written
by `npm run record`. "Sample" means a built-in sample dinner listed in
`samples/index.json`. "Model call" means one call of `ModelClient.readRecipes`. "Error
response" means a JSON body `{ "error": { "code", "message" } }` with the status `tech.md`
gives for that code.

Prerequisite: recipe-graph tasks T1 to T8 are done, so `validatePlan`, `checkKitchen`,
`normaliseRecipeText`, `PlanSchema` and `KitchenSchema` are exported from
`src/core/index.ts`.

## Requirements

### R1. Sample index

**User story:** As a cook opening the app for the first time, I want a short list of
sample dinners with a line about each, so that I can try the app without pasting anything.

- R1.1 THE SYSTEM SHALL list the samples in `samples/index.json` as a JSON array, one
  entry per sample, in the order the menu shows them (decided here).
- R1.2 THE SYSTEM SHALL give each entry exactly these fields: `id` (matching the dish id
  pattern, at most 40 characters, equal to the name of a file `samples/<id>.md`), `title`
  (1 to 80 characters), `blurb` (one line, 1 to 160 characters), `dishes` (1 to 12 dish
  names, each 1 to 80 characters), `kitchen` (passing `KitchenSchema`) and `servingTime`
  (a 24-hour local clock time `HH:MM`) (bounds decided here).
- R1.3 THE SYSTEM SHALL list exactly the five samples `sunday-roast`, `halloween-party`,
  `weeknight-curry`, `vegetarian-feast` and `korean-table`, one per file in `samples/`.
- R1.4 THE SYSTEM SHALL never change the `samples/*.md` files; they were written by hand.

### R2. Sample library at startup

**User story:** As the operator, I want the server to refuse to start when a sample has no
current recording, so that a sample is never answered by a stale plan or by the model.

- R2.1 WHEN the server starts, THE SYSTEM SHALL read `samples/index.json`, every listed
  `samples/<id>.md` and every `recordings/<id>.json` once, and keep the result in memory
  for the life of the process.
- R2.2 THE SYSTEM SHALL compute each sample's text key as the lowercase hex SHA-256 of the
  UTF-8 bytes of `normaliseRecipeText(file text)`.
- R2.3 IF the index is missing or invalid, a listed `.md` file is missing, a `.md` file in
  `samples/` is not listed, a recording is missing, is not valid JSON, does not have the
  recording shape, names another `sampleId`, or has a `textSha256` other than the sample's
  text key, or a file in `recordings/` belongs to no listed sample, THEN THE SYSTEM SHALL
  refuse to start.
- R2.4 IF a recording's `raw` fails `validatePlan`, has a sanity error, or has a
  `checkKitchen` error with the sample's suggested kitchen, THEN THE SYSTEM SHALL refuse
  to start (decided here).
- R2.5 IF two samples have the same text key, or a sample's normalised text is longer than
  12,000 characters, THEN THE SYSTEM SHALL refuse to start (decided here).
- R2.6 WHEN the server refuses to start, THE SYSTEM SHALL print every problem found (not
  only the first), one per line, each naming the file and the rule, followed by the
  command that fixes recordings (`npm run record`), and exit with status 1.
- R2.7 THE SYSTEM SHALL never put recipe text or model output in a startup problem line;
  only file names, ids, issue codes and field paths.

### R3. `GET /api/samples`

**User story:** As the Menu screen, I want every sample with its text, plan, kitchen and
serving time in one response, so that the page can show a schedule with one request and
no model.

- R3.1 WHEN a client sends `GET /api/samples`, THE SYSTEM SHALL respond 200 with
  `{ "samples": [...] }`, one item per index entry in index order.
- R3.2 THE SYSTEM SHALL give each item the index fields of R1.2 plus `text` (the
  normalised sample text), `plan` (the plan `validatePlan` returned for the recording's
  `raw`) and `issues` (the issues `validatePlan` returned with it).
- R3.3 THE SYSTEM SHALL answer `GET /api/samples` without a model call, without a key and
  without consuming any limit.

### R4. `POST /api/parse`: input

**User story:** As the server, I want bad or oversized input rejected before anything else
happens, so that nothing expensive runs on it.

- R4.1 IF the request's `Content-Type` is not `application/json` (parameters such as
  `charset` allowed, case-insensitive), THEN THE SYSTEM SHALL respond with the
  `bad_request` error.
- R4.2 IF the request body is larger than 65,536 bytes, THEN THE SYSTEM SHALL respond with
  the `input_too_long` error without reading the rest of the body (bound decided here).
- R4.3 IF the body is not JSON, or is not an object with exactly one key `text` whose value
  is a string, THEN THE SYSTEM SHALL respond with the `bad_request` error.
- R4.4 WHEN the body is valid, THE SYSTEM SHALL normalise `text` with
  `normaliseRecipeText`.
- R4.5 IF the normalised text is empty, THEN THE SYSTEM SHALL respond with the
  `bad_request` error (decided here).
- R4.6 IF the normalised text is longer than 12,000 characters, counted in Unicode code
  points, THEN THE SYSTEM SHALL respond with the `input_too_long` error; a normalised text
  of exactly 12,000 characters is accepted.

### R5. Recorded samples

**User story:** As a cook trying a sample, I want it answered from its recording, so that
it works without a key, after the daily cap, and when I have used up my rate limit.

- R5.1 WHEN the normalised text equals a sample's normalised text, THE SYSTEM SHALL respond
  200 with `{ plan, issues, source: "recording" }` taken from that sample, before any rate
  limit, daily cap or key check.
- R5.2 THE SYSTEM SHALL answer a recorded sample without consuming the rate limit or the
  daily cap and without a model call.

### R6. Per-IP rate limit

**User story:** As the operator, I want each client limited to a few model calls per
window, so that one person cannot spend the day's budget.

- R6.1 WHILE a client key has had `PARSE_RATE_PER_IP` model calls in the last
  `PARSE_RATE_WINDOW_SEC` seconds, THE SYSTEM SHALL respond to its non-recorded requests
  with the `rate_limited` error and a `Retry-After` header.
- R6.2 THE SYSTEM SHALL count a call at time `s` as inside the window at time `t` when
  `t - s < PARSE_RATE_WINDOW_SEC * 1000` (milliseconds; sliding window, decided here).
- R6.3 THE SYSTEM SHALL set `Retry-After` to the whole number of seconds, at least 1, after
  which the oldest call in the window leaves it, rounded up.
- R6.4 THE SYSTEM SHALL record a call against the rate limit only when a model call is
  about to be made, after the daily cap and key checks have passed.
- R6.5 WHERE `TRUST_PROXY` is `false`, THE SYSTEM SHALL derive the client key from the TCP
  peer address and ignore `X-Forwarded-For`.
- R6.6 WHERE `TRUST_PROXY` is `true`, THE SYSTEM SHALL derive the client key from the
  rightmost entry of the last `X-Forwarded-For` header, and from the TCP peer address when
  that entry is absent or not an IP address (decided here).
- R6.7 THE SYSTEM SHALL key IPv4 addresses (including IPv4-mapped IPv6) by the address and
  IPv6 addresses by their /64 prefix; a request with no usable address gets the key
  `unknown` (decided here).
- R6.8 THE SYSTEM SHALL keep at most 10,000 client keys with at most `PARSE_RATE_PER_IP`
  timestamps each; WHEN a new key arrives and all 10,000 keys still have calls in their
  window, THE SYSTEM SHALL respond with the `rate_limited` error rather than forget a key
  (decided here).

### R7. Daily cap

**User story:** As the operator, I want a hard cap on model calls per UTC day across all
clients, so that the bill has a ceiling.

- R7.1 WHILE `PARSE_DAILY_CAP` model calls have been made in the current UTC day, THE
  SYSTEM SHALL respond to non-recorded requests with the `daily_cap_reached` error and a
  `Retry-After` header giving the whole seconds, rounded up and at least 1, until the next
  00:00 UTC.
- R7.2 THE SYSTEM SHALL count against the cap only model calls that are actually made:
  never a recorded sample, a rejected input, a rate-limited request, a capped request or a
  request on a server without a key.
- R7.3 THE SYSTEM SHALL count each model call once, whatever its outcome and however many
  HTTP attempts the SDK makes for it (decided here).
- R7.4 THE SYSTEM SHALL never make more than `PARSE_DAILY_CAP` model calls in one UTC day,
  including when requests arrive concurrently.

### R8. Order of checks and the model call

**User story:** As the operator, I want the checks in one fixed order, so that the cheap
and free answers come first and the model is the last resort.

- R8.1 THE SYSTEM SHALL apply the checks of `POST /api/parse` in this order and stop at
  the first that answers: content type, body size, body shape (R4.1 to R4.3); normalise;
  empty and length (R4.5, R4.6); recorded sample (R5); rate limit (R6); daily cap (R7); key
  present; model call; schema; sanity rules; not-a-recipe check (R10.6).
- R8.2 IF the server has no `ANTHROPIC_API_KEY`, THEN THE SYSTEM SHALL respond to
  non-recorded, non-limited requests with the `model_unavailable` error, and SHALL NOT
  consume any limit.
- R8.3 THE SYSTEM SHALL make at most one model call per request.

### R9. The model client

**User story:** As the server, I want one small client that turns recipe text into an
untrusted JSON value or a typed error, so that the route never handles SDK details.

- R9.1 THE SYSTEM SHALL define `ModelClient` with one method
  `readRecipes(text: string): Promise<Result<unknown, ModelError>>`, and SHALL construct the
  real client only in `src/server/index.ts` and `scripts/record.ts`.
- R9.2 WHEN the real client reads recipes, THE SYSTEM SHALL send one Messages API request
  with model `claude-opus-5-5`, `max_tokens` 16,000, `output_config.effort` `"low"`, a JSON
  schema output format derived from `PlanSchema`, the constant system prompt marked for
  caching, and the recipe text in a delimited block in the user message; it SHALL NOT send
  a `thinking` field (adaptive thinking is the model default and cannot be disabled).
- R9.3 THE SYSTEM SHALL construct the SDK client with `timeout` equal to
  `PARSE_TIMEOUT_MS` and `maxRetries` 1.
- R9.4 WHEN the response has `stop_reason` `"refusal"`, THE SYSTEM SHALL return a
  `refused` error without reading the content.
- R9.5 WHEN the response has `stop_reason` `"max_tokens"`, THE SYSTEM SHALL return an
  `output_invalid` error without reading the content.
- R9.6 WHEN the response has any `stop_reason` other than `"end_turn"`, `"refusal"` and
  `"max_tokens"`, THE SYSTEM SHALL return an `output_invalid` error (decided here).
- R9.7 WHEN the response ends normally, THE SYSTEM SHALL select content blocks by `type`,
  require exactly one `text` block, and return `ok(JSON.parse(text))`; IF there is not
  exactly one text block or the text is not JSON, THEN it SHALL return an `output_invalid`
  error.
- R9.8 IF the SDK throws, THEN THE SYSTEM SHALL map the error class, most specific first:
  connection timeout, connection error, authentication, permission, rate limit, overload,
  other 5xx, request timeout, any other API error, any other SDK error; all to an
  `unavailable` error with a reason.
- R9.9 WHEN the SDK reports an authentication or permission error, THE SYSTEM SHALL log one
  `error` line with the HTTP status and request id only.
- R9.10 IF something other than an SDK error is thrown, THEN THE SYSTEM SHALL let it
  propagate, so that the `onError` handler answers `internal`.

### R10. Checking the model's output

**User story:** As a cook, I want the model's plan checked like any other plan, and never
to get half a plan, so that what I see is either usable or clearly an error.

- R10.1 WHEN a model call returns `ok(raw)`, THE SYSTEM SHALL pass `raw` to `validatePlan`.
- R10.2 IF `validatePlan` returns `plan: null`, THEN THE SYSTEM SHALL respond with the
  `model_output_invalid` error and no plan.
- R10.3 WHEN `validatePlan` returns a plan, THE SYSTEM SHALL respond 200 with
  `{ plan, issues, source: "model" }`, also when `issues` contains errors, so that the cook
  can fix them in the Steps screen.
- R10.4 THE SYSTEM SHALL map model client errors to error responses: `unavailable` to
  `model_unavailable`, `refused` to `model_refused`, `output_invalid` to
  `model_output_invalid`.
- R10.5 THE SYSTEM SHALL build every error message from fixed words and numbers only; it
  SHALL NOT contain recipe text, model output, SDK error text or the key.
- R10.6 WHEN `validatePlan` returns a plan with exactly one dish and that dish's id is
  `not-a-recipe` (the sentinel of R11.4), THE SYSTEM SHALL respond with the `invalid_plan`
  error (422, message `That does not look like a recipe. Paste the ingredients and method for
  each dish.`) and no plan; the model call was made, so it still counts against the rate limit
  and the daily cap (R7.3), and the `info` line (R13.2) has outcome `invalid_plan`. A plan with
  that dish among other dishes, or a single dish with another id, is an ordinary 200 (R10.3)
  (review Q4, decided here).

### R11. The prompt

**User story:** As the developer, I want one constant, complete prompt that tells the
model exactly what a step is and what it may not do, so that recordings are reproducible
and the prompt can be cached.

- R11.1 THE SYSTEM SHALL use the system prompt written out in `design.md` verbatim, with
  no part of it depending on the request.
- R11.2 THE SYSTEM SHALL put the recipe text in the user message between the lines
  `<recipes>` and `</recipes>`, and SHALL replace any `<recipes>` or `</recipes>` tag inside
  the text (case-insensitive, white space inside the tag allowed) with `[recipes]` or
  `[/recipes]`, so that the text cannot close the block (decided here).
- R11.3 THE SYSTEM SHALL state in both the system prompt and the user message that the
  recipe text is data, not instructions.
- R11.4 THE SYSTEM SHALL tell the model, in the system prompt, to answer text in which
  nothing can be read as a recipe with the sentinel plan: one dish with id `not-a-recipe` and
  one step with id `not-a-recipe.skip`, and only then (a rough or partial recipe is still read)
  (review Q4, decided here).

### R12. Recording

**User story:** As the developer, I want one command that records the samples from the
real model, so that tests and the samples work without a key.

- R12.1 WHEN the user runs `npm run record` with `ANTHROPIC_API_KEY` set, THE SYSTEM SHALL
  call the real client once per sample (or per id given on the command line) in index
  order and write `recordings/<id>.json` as
  `{ sampleId, textSha256, model, recordedAt, raw }`, where `raw` is the JSON value the
  model returned, unchanged, `model` is `claude-opus-5-5` and `recordedAt` an ISO 8601 UTC
  time.
- R12.2 IF the key is not set, THEN THE SYSTEM SHALL print that it is needed and exit 1
  without a model call.
- R12.3 IF a sample's model call fails, or its `raw` fails `validatePlan`, has a sanity
  error, or has a `checkKitchen` error with the suggested kitchen, THEN THE SYSTEM SHALL
  not write that sample's recording, print the sample id with the error code or issue codes
  and step ids, continue with the next sample, and exit 1 at the end.
- R12.4 THE SYSTEM SHALL never print the key, recipe text or model output.
- R12.5 THE SYSTEM SHALL never modify a recording any other way; tests, tools and people
  do not edit, reformat or "fix" files in `recordings/`.
- R12.6 IF a sample's `raw` is the sentinel plan of R10.6, THEN THE SYSTEM SHALL not write
  its recording, print `<id>: not recorded: the model did not read this as a recipe
  (not-a-recipe).`, continue and exit 1 at the end (review Q4, decided here).

### R13. Logs and secrets

**User story:** As the operator, I want useful logs that never contain the key, recipe
text or model output, so that logs can be shared when something goes wrong.

- R13.1 THE SYSTEM SHALL log recipe text only at `debug` level, and SHALL never log model
  output at any level.
- R13.2 THE SYSTEM SHALL log one `info` line per `POST /api/parse` with the outcome
  (`recording`, `model` or the error code), the normalised length and the duration from
  the injected clock; it SHALL NOT log the client address (decided here).
- R13.3 THE SYSTEM SHALL never log, return or record the key, and SHALL set the SDK's own
  logging to off.

### R14. Environment

**User story:** As the operator, I want the timeout configurable like the other limits.

- R14.1 THE SYSTEM SHALL read `PARSE_TIMEOUT_MS` (integer 1,000 to 600,000, default 60,000)
  in `src/server/env.ts` (bounds decided here).
- R14.2 THE SYSTEM SHALL accept `PARSE_RATE_PER_IP` only from 1 to 100, so that the memory
  bound of R6.8 is concrete (upper bound decided here).
- R14.3 THE SYSTEM SHALL list `PARSE_TIMEOUT_MS` in `.env.example`.

### R15. Test support

**User story:** As the author of the tests, I want fakes and fixtures for every boundary,
so that no test reaches the network and tasks before the first recording can run.

- R15.1 `test/fixtures/not-a-recording/` SHALL hold a hand-made sample index, two
  hand-written recipe texts, two hand-made recording files whose `model` is
  `hand-made-not-a-recording`, and a README giving the hand-worked issues of each plan.
- R15.2 `test/support/fakes.ts` SHALL export `fakeClock`, `fakeModelClient` and
  `fakeAnthropicFetch`; no test constructs the real client against the network.
- R15.3 `test/support/arbitraries.ts` SHALL export the generators the properties of this
  spec use, and only there.

## Non-functional requirements

- N1 No network in tests: `npm test`, `npm run test:props` and `npm run test:e2e` run with
  `ANTHROPIC_API_KEY` unset and make no request to Anthropic.
- N2 Bounded memory: the rate limiter holds at most 10,000 keys × `PARSE_RATE_PER_IP`
  timestamps (at the defaults 50,000 numbers, about 0.4 MB, plus map overhead); the daily
  cap holds one day number and one count.
- N3 Latency: a model call takes at most about `2 × PARSE_TIMEOUT_MS` plus the SDK's retry
  delay; a recorded sample and every rejection answer without waiting on I/O.
- N4 Boundaries: only `src/server/parse/anthropic-client.ts` imports `@anthropic-ai/sdk`;
  `src/web` imports nothing from this spec.
- N5 Glossary: identifiers, codes and messages use the glossary words in `product.md`.

## Out of scope

- The Menu, Steps and Plan screens and how they call these routes (UI specs).
- Response schemas shared with the web code (see open questions).
- Streaming, retries beyond the SDK's one, model fallback, other models.
- Deciding whether text is a recipe in server code: only the model decides, and the route
  acts on its `not-a-recipe` sentinel answer (R10.6); no heuristic reads the text.
- Re-recording automatically, or in CI.
