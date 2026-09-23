# Output-check adapter and compatibility kit

Framework-neutral adapter for an **existing** acceptance check you already run,
plus a kit that tests it the way Millwork will call it.

Millwork calls your endpoint over HTTPS POST with `{ "candidate": … }` and
expects a `VerifierResult` (`is_correct`, `quality_score`, optional
`anchor_results`). This is a translation layer, not a new checker and not a
named-supplier adapter.

`millwork verifier init <directory>` writes these files for you; every command
below is run from that directory.

| File | What it is |
|---|---|
| `handler.mjs` | The adapter (`millwork-output-check-adapter` 1.0.0). |
| `compatibility-kit.mjs` | The kit (`millwork-output-check-kit` 1.0.0). |
| `check-endpoint.mjs` | Runs the kit from a terminal. |
| `listing-example-check.mjs` | The default listing example. Edit it in place, or point `selected-check.mjs` at your own file. |
| `minimal-output-check.mjs` | Recipe 0's deliberately small non-empty-output check. |
| `recipe-a-structured-output.mjs` | Exact schema, identifier and arithmetic example check. |
| `recipe-b-semantic-judgment.mjs` | Typed semantic judgment with exact checks and your organization's thresholds. |
| `recipe-c-evaluator-adapter.mjs` | Thin existing-evaluator translation with rules your organization owns. |
| `recipe-d-completion-evidence.mjs` | Agent or pipeline completion backed by a trusted evidence store. |
| `selected-check.mjs` | The selected check re-exported for local tests, the deployed app, and endpoint tests. |
| `existing-node-app.mjs` | Maintained existing-app route composition and runnable deployment example. |
| `minimal-node-dock.mjs` | Small public Node server for learning the request and response boundary. |
| `minimal-python-dock.py` | Small public Python server for learning the same boundary without Node. |
| `DEPLOYMENT_RECIPE.md` | HTTPS deployment, measurement, key overlap/removal and recovery recipe. |

## Choose an example check

When you omit `--recipe`, the command selects `listing-example-check.mjs`:

```bash
millwork verifier init output-check
```

When you already know the decision shape, select one maintained example check.
Every recipe uses the same server, access, deployment, and recovery code.

```bash
millwork verifier init output-check-a --recipe a
```

Use `0` for the deliberately small non-empty-output check, `a` for structured output and exact policy, `b` for typed semantic
judgment, `c` for an existing evaluator adapter, or `d` for agent or pipeline
completion. The command prints the selected module and the exact local test to
run next. Each example check includes a labelled pass, rejection and technical
failure. Replace its example policy and fixtures with evidence from your own
domain before deployment.

`selected-check.mjs` is written for the recipe you chose. The runnable
`existing-node-app.mjs` and both local and deployed tests use that file,
so the endpoint runs the same rules you tested locally. Deploy the whole
generated directory, including `selected-check.mjs` and the check it imports.

The Python server is intentionally small and public. It demonstrates the wire
shape, reserved probe and status behavior. Use `handler.mjs` for the maintained
body, timeout and authenticated-access protections, or implement equivalent
protections in the non-Node server you deploy.

## Candidate mapping

- **Model output** arrives as a string. The adapter parses a JSON object or array
  string, treats other text as `{ "summary": "<text>" }` so an existing
  quality function can score it, and fail-closes unparseable `{` / `[` text.
- **Structured agent output** arrives as JSON. It is passed through unchanged.
- The reserved registration probe, and a `solverapi_probe` key anywhere in the
  candidate before or after parsing, get `is_correct: false`,
  `quality_score: 0` without running your check.

## Choose the endpoint's access

There is no default. An endpoint is never public by omission.

```javascript
import { createServer } from "node:http";
import {
  authenticatedAccess,
  createOutputCheckRequestListener,
  keysFromEnvironment,
} from "./handler.mjs";

createServer(createOutputCheckRequestListener({
  access: authenticatedAccess({ acceptedKeys: keysFromEnvironment("MILLWORK_VERIFIER_KEYS") }),
  runHardCheck: yourExistingHardCheck,
  scoreQuality: yourExistingQualityScore,
})).listen(8080);
```

- **Authenticated.** Millwork sends `Authorization: Bearer <key>`. The adapter
  checks the key before it reads the request, so without a valid key neither
  the probe nor your check can be reached. Use a key issued only for this
  endpoint, never a Millwork account API key (a `solverapi_live_` key is
  refused as misconfiguration).
- **Public.** `access: publicAccess()` accepts calls with no key. Choose it only
  when anyone who can reach the URL may call it.

With authenticated access and no key configured, every request gets `503`:
the endpoint fails closed instead of turning public.

### Replace a key without editing code

`MILLWORK_VERIFIER_KEYS` holds one key, or several separated by commas while
you rotate. The adapter reads it on each request.

Set it where your application's environment is configured -- your host's
settings or secret manager -- not by typing the key into a terminal, where it
lands in shell history and in the process list. The values below are the
shapes to configure, not commands to run.

1. Add the replacement: `MILLWORK_VERIFIER_KEYS=<current>,<replacement>`.
2. Give Millwork the replacement and retest.
3. Remove the old key: `MILLWORK_VERIFIER_KEYS=<replacement>`. The old key is
   now rejected when presented directly.

Whether a changed variable reaches a running process depends on your host;
many restart the app when a variable changes.

## Answers the adapter gives

| Situation | Answer |
|---|---|
| Your check ran | `200` with the `VerifierResult` |
| Reserved probe or probe marker | `200` with `is_correct: false`, `quality_score: 0` |
| Missing or wrong key | `401` `{ "error": "unauthorized" }` |
| No keys configured / account key configured | `503` `{ "error": "endpoint_keys_not_configured" }` / `endpoint_keys_misconfigured` |
| Not POST | `405` `method_not_allowed` |
| Body not JSON / no `candidate` | `400` `malformed_request` / `missing_candidate` |
| Body over 1 MiB / not received within 5 s | `413` `request_too_large` / `408` `request_timeout` |
| Your check throws / returns a non-`VerifierResult` | `500` `check_failed` / `check_result_invalid` |
| Your check takes longer than 8 s | `504` `check_timeout` |

Every non-`200` answer is `{ "error": … }` and never a verdict, so Millwork
records a technical failure rather than a pass or a rejection. Error answers
never repeat your check's error message. Limits are adjustable with
`limits: { maxBodyBytes, bodyReadTimeoutMs, checkTimeoutMs }`. The check
deadline bounds waiting, not work: it cannot interrupt a synchronous loop.

## Test it with the kit

Write labelled cases from your own check: each names a candidate and its
expected verdict, with at least one pass and one rejection. For a local
technical-failure case, set `fault: "check_throws"` or `fault: "invalid_result"`
beside the candidate. The kit injects that fault into its own local listener;
the candidate cannot request it, and the deployed test skips it. A genuine
external failure can still be tested against a controlled endpoint. See
`listing-example-check.mjs` and the four recipe checks.

**Locally**, before any account or credential:

```bash
node check-endpoint.mjs --local --check ./selected-check.mjs --access authenticated
```

This serves your check through this adapter on loopback with keys generated
for the run. The kit rotates them, injects local faults to confirm no-verdict
technical failures, and swaps only the quality scorer to confirm the hard
verdict does not move.

**Deployed**, against your https URL. This sends labelled test requests,
including intentional failures, so it needs `--authorize-endpoint-test`.

The kit reads the endpoint's key from `MILLWORK_KIT_ENDPOINT_KEY`. Load it into
this shell's environment privately -- from your secret manager, a hidden prompt,
or a file only you can read -- so it never reaches shell history, a process
list, or an assistant's transcript. The kit refuses any argument named like a
credential, so the key is never part of the command. Then run:

```bash
node check-endpoint.mjs --deployed https://app.example/millwork-check \
  --authorize-endpoint-test --check ./selected-check.mjs --access authenticated
```

While rotating, set `MILLWORK_KIT_OVERLAP_KEYS` to other keys the endpoint must
also accept now. After removing a key, set `MILLWORK_KIT_RETIRED_KEYS` to confirm
it is rejected. Add `--json` for a machine-readable report. The exit status is
`0` when every case passes, `1` when one fails and `2` when the run is refused
before testing.

The kit checks the request/result contract, endpoint access and timing.
Every case must answer within the bound Millwork applies to it (3 s for
probe-shaped requests, 10 s for an evaluation), measured from send to the
last response byte, and within Millwork's 1 MiB response limit. A structured
case re-sent as model text must get the same full result, anchors included.
It does not certify that your check is correct, and passing it is not a
customer connection. No report contains a key.

## Connect the deployed URL to Millwork

Connect with the same `millwork` CLI that wrote these files
(`millwork verifier init`), rather than by hand.

`--access` here says how **Millwork reaches your endpoint**. It is a different
choice from the adapter's own access mode, and the two must agree:

| The adapter, in your code | The connection, on `verifier connect` |
|---|---|
| `publicAccess()` | `--access public` -- your endpoint accepts calls with no key. |
| `authenticatedAccess({ acceptedKeys })` | `--access managed` -- Millwork holds a key for your endpoint. You enter it on a private Millwork page; it is never passed as an argument. |

For public endpoints, pass `--name` and `--version` when the terminal cannot
prompt. The examples below set both explicitly for either access mode.

### A public endpoint

One command registers the check, probes it, and stops:

```bash
millwork verifier connect \
  --endpoint https://app.example/millwork-check \
  --access public \
  --name "Listing extraction check" \
  --version "1.0.0" \
  --connect-only \
  --json
```

`--connect-only` stops after the probe instead of starting a run. Keep the
`verifier_id` from the result; registering a check does not select it for later
work. The connection is usable only when `headline` is `ready` and
`probe.contract.validated` is `true`. A refused connection still returns a
`verifier_id` -- keep it for repair, do not run with it. The command exits `1`
when the headline is anything other than `ready`.

### An endpoint that requires a key

Set `CUSTOMER_APP_ORIGIN` to the HTTPS origin of the Millwork app you sign in
to. This is required for both browser and terminal key entry. It is a
non-secret trust setting:

```bash
export CUSTOMER_APP_ORIGIN="https://app.example"
```

Issue a key for this endpoint and configure the deployed app to accept it
first. Then:

```bash
millwork verifier connect \
  --endpoint https://app.example/millwork-check \
  --access managed \
  --name "Listing extraction check" \
  --version "1.0.0" \
  --stop-days 90 \
  --json
```

`--stop-days` is when Millwork stops using its stored copy of the key: `30`,
`90`, `180`, `365`, or `0` for no stop date. The CLI requires it rather than
choosing one for you. This path never starts a run.

The key is not part of that command and never passes through it. The command
registers the check and answers `state: "action_required"` with a
`verifier_id`, a private `continue_url`, an `intent_id`, and `expires_at`, and
exits `2`. That is the expected outcome here, not a failure.

Sign in to Millwork in your own browser, with the same organization and an
account that can manage checks, and open `continue_url` to enter the key. Then
finish that same connection:

```bash
millwork verifier continue \
  --verifier-id "<verifier_id from the previous step>" \
  --intent-id "<intent_id from the previous step>" \
  --json
```

Two fields in that result say two different things. The top-level `state`
describes this one command: `done` means it finished. The nested
`connection.status` describes the stored key: `active` means Millwork holds a
key it has tested. Both must be right, and `verifier_id` must still be the one
the first command returned. `state: "action_required"` with `next_action`
`enter_key` means the key has not been entered on the page yet; run the same
command again once it has. A `verifier_id` on its own records an attempt, not
an active connection.

Without `--json`, at a terminal that can prompt, the command offers a hidden
prompt for the key before printing the page; press Enter to use the page
instead. `CUSTOMER_APP_ORIGIN` is not a credential. It is the destination
trust setting used for both the private page and direct entry through the
hidden prompt or `VERIFIER_CONNECTION_SECRET`. The CLI refuses an entry address
that does not match this setting.

### Confirm the connection

Either path ends the same way. Run a fresh test, and run it again whenever the
endpoint or its key changes:

```bash
millwork verifier test \
  --verifier-id "<the verifier_id you kept>" \
  --idempotency-key "verifier-test-$(node -e 'process.stdout.write(crypto.randomUUID())')" \
  --json
```

The check is connected and usable when that result has `headline` `ready`,
`probe.contract.validated` `true`, and a `verifier_id` matching the one you
kept. The reserved probe answers `is_correct: false`; that verdict is
deliberate and does not make a compatible endpoint unusable. Use a new
`--idempotency-key` for each new observation, and reuse the same one only to
retry an answer that was lost. Do not assume a later run retests the
connection for you.

To place this route in a Node application you already deploy, follow the
[`existing-node-app.mjs` deployment recipe](DEPLOYMENT_RECIPE.md). It records
the runtime and internet-reachable HTTPS checks required for a real placement without
requiring a new service or hosting vendor.

## Secondary path

`emptyFailClosedHardCheck` always returns `is_correct: false` with a real
quality score. It is an educational empty module, not a success placeholder
and not the customer journey.
