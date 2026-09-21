# Existing Node app deployment recipe

This is the maintained placement recipe for adding the authenticated
output-check adapter to a Node 20 or newer HTTP application you already deploy.
It creates one route in that application. It does not require another service,
hosting vendor, database, queue, or asynchronous protocol.

This recipe is generic integration guidance. Completing it does not certify your
check and does not connect your endpoint to Millwork; connect the deployed URL
with `millwork verifier connect` once the kit passes.

Choose the endpoint's access mode before you configure anything, then follow one
branch to the end: **authenticated**, where Millwork presents a Bearer key the
endpoint accepts, or **public**, where the endpoint accepts any caller that can
reach the URL. The two branches do not mix.

## Runtime and route

The maintained example is [`existing-node-app.mjs`](existing-node-app.mjs):

- runtime: Node.js 20 or newer;
- health route: `GET /healthz`;
- verifier route: `POST /millwork-check`;
- start command from the generated directory: `node existing-node-app.mjs`;
- port: integer `PORT`, default `8080`;
- endpoint access: Bearer keys from `MILLWORK_VERIFIER_KEYS`;
- probe budget: 3 seconds; evaluation budget: 10 seconds;
- adapter limits: a 5-second body-read deadline and an 8-second check deadline.

HTTPS termination stays with the application's current host or reverse proxy.
Do not expose the direct process port publicly when the existing application
already has an HTTPS ingress.

## Add the route to an existing app

Keep the existing app's listener and compose the adapter before its fallback:

```javascript
import { createServer } from "node:http";
import { createExistingNodeAppListener } from "./existing-node-app.mjs";
import { runHardCheck, scoreQuality } from "./listing-example-check.mjs";

const existingApp = async (request, response) => {
  // The routes your application already serves.
  response.writeHead(404).end();
};

createServer(createExistingNodeAppListener({
  runHardCheck,
  scoreQuality,
  otherwise: existingApp,
})).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
```

The listener handles `/millwork-check` and `GET /healthz`. Other requests go to
`otherwise`. If your app already serves `/healthz`, pass `healthPath: null` to
keep that route. Use the actual hard check
and quality scorer you already run. The direct start command imports
`runHardCheck` and `scoreQuality` from `listing-example-check.mjs`, so it runs
the same example you edited and tested locally.

`createExistingNodeAppListener` uses authenticated access by default. To serve
a public endpoint, pass `access: publicAccess()`, as shown below.

## Configure and deploy an authenticated endpoint

Follow these steps when the endpoint authenticates Millwork with a key. For a
public endpoint, skip to the next section; none of these steps apply there.

1. Generate an endpoint-only random key in the host's secret manager. Never use
   a `solverapi_live_` Millwork account key.
2. Set `MILLWORK_VERIFIER_KEYS=<current>` on the existing application and deploy
   it through that application's normal release path.
3. Confirm `GET https://app.example/healthz` reports the expected Node and
   adapter versions. The response contains no key. `createExistingNodeAppListener`
   serves this route itself; pass `healthPath: null` if your application already
   owns that path, and record your own health check instead.
4. Load `MILLWORK_KIT_ENDPOINT_KEY` from your secret manager or a private
   terminal you control. Keep its value out of command text, shell history and
   assistant output. Then run the compatibility kit against the public HTTPS
   route:

   ```bash
   node check-endpoint.mjs \
     --deployed https://app.example/millwork-check \
     --authorize-endpoint-test \
     --check listing-example-check.mjs \
     --access authenticated --json
   ```

The kit deliberately sends passing, rejecting, malformed, unauthenticated,
probe-shaped, chunked, and technical-failure cases. Run it only against an
endpoint where you are authorized to create that traffic. Reports retain status,
bounded elapsed time, and verdict shape; they redact credentials and response
free text.

## Configure and deploy a public endpoint

Choose this branch only when the candidates Millwork sends are public or test
material. A public endpoint has no key: anyone who can reach the URL may submit
candidates and read the verdicts your check returns. Do not use it for
confidential or customer content, or for a check whose verdicts you would not
publish. When that is uncertain, take the authenticated branch instead.

The same maintained composition serves a public endpoint; say so explicitly,
and it keeps the check route, the health route and the host fallback exactly as
the authenticated branch has them:

```javascript
import { createServer } from "node:http";
import { publicAccess } from "./handler.mjs";
import { createExistingNodeAppListener } from "./existing-node-app.mjs";
import { runHardCheck, scoreQuality } from "./listing-example-check.mjs";

const existingApp = async (request, response) => {
  // The routes your application already serves.
  response.writeHead(404).end();
};

createServer(createExistingNodeAppListener({
  access: publicAccess(),
  runHardCheck,
  scoreQuality,
  otherwise: existingApp,
})).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
```

Without that `access` line the route is authenticated: an endpoint is never
public by omission.

1. Deploy through the application's normal release path. There is no endpoint
   key to generate and no `MILLWORK_VERIFIER_KEYS` to set, so skip the
   authenticated branch's key steps and **Replace and retire a key** entirely.
2. Confirm `GET https://app.example/healthz` reports the expected Node and
   adapter versions. The response carries versions only, never a key and
   nothing about any request.
3. Run the compatibility kit against the public HTTPS route. A public run reads
   no key from the environment, and `MILLWORK_KIT_ENDPOINT_KEY`,
   `MILLWORK_KIT_OVERLAP_KEYS` and `MILLWORK_KIT_RETIRED_KEYS` have no effect
   on it:

   ```bash
   node check-endpoint.mjs \
     --deployed https://app.example/millwork-check \
     --authorize-endpoint-test \
     --check listing-example-check.mjs \
     --access public --json
   ```

   The kit still sends passing, rejecting, malformed, probe-shaped, chunked and
   technical-failure cases, so run it only against an endpoint where you are
   authorized to create that traffic. It records the endpoint's public access in
   place of the missing-key and wrong-key refusals, which cannot apply here.
4. Connect the deployed URL, exactly as **Connect the deployed URL to Millwork**
   in README.md describes for a public endpoint. `--name` and `--version` are
   required: without a terminal to ask in, the command stops and says so rather
   than guessing them.

   ```bash
   millwork verifier connect \
     --endpoint https://app.example/millwork-check \
     --access public \
     --name "Listing extraction check" \
     --version "1.0.0" \
     --connect-only \
     --json
   ```

   The adapter's mode and the connection's mode must agree: `publicAccess()`
   pairs with `--access public`, never with `--access managed`. Keep the
   `verifier_id` from the result, and treat the connection as usable only when
   `headline` is `ready` and `probe.contract.validated` is `true`.

**Measure cold and warm behavior** below applies unchanged. In **Recovery**,
the three key answers -- `503 endpoint_keys_not_configured`,
`503 endpoint_keys_misconfigured` and `401 unauthorized` -- cannot occur on a
public endpoint; the `500` and `504` answers still can.

## Measure cold and warm behavior

After a fresh deploy or host restart, run the deployed kit once and retain its
JSON as the **cold observation**. Run it again without a configuration change as
the **warm observation**. Record:

- the exact deployment revision and public HTTPS URL;
- Node and adapter versions from `/healthz`;
- the host's restart/cold-start event or deployment identifier;
- the first and second kit reports, including per-case elapsed milliseconds;
- whether every probe-shaped case stayed below 3 seconds and every evaluation
  stayed below 10 seconds.

The adapter adds no timeout extension. A placement that misses either inherited
budget is not ready for registration.

## Replace and retire a key

The adapter reads `MILLWORK_VERIFIER_KEYS` on every request. The process does not
cache it, but many hosts apply a variable change by restarting or redeploying the
application. Record the behavior of the selected host; do not claim a live update
unless the running process actually receives one.

1. Configure overlap: `MILLWORK_VERIFIER_KEYS=<current>,<replacement>`.
2. Apply the host's required restart or redeploy and record the propagation time.
3. In a private terminal, load the replacement into
   `MILLWORK_KIT_ENDPOINT_KEY` and the current key into
   `MILLWORK_KIT_OVERLAP_KEYS`. Do not ask an assistant to read or construct
   either value. Clear the previous test stage's expectations before running
   the next test. Test both keys:

   ```bash
   unset MILLWORK_KIT_RETIRED_KEYS
   node check-endpoint.mjs \
     --deployed https://app.example/millwork-check \
     --authorize-endpoint-test \
     --check listing-example-check.mjs \
     --access authenticated --json
   ```

4. [Replace the key in Millwork](https://docs.getmillwork.dev/guides/connect-an-output-check#a-protected-connection-needs-recovery)
   and confirm that this connection now uses the replacement key. Keep both
   keys accepted at the endpoint until that switch is confirmed. If the result
   is uncertain, preserve the printed operation key and handle and continue
   that same operation.
5. Configure only the replacement key at the endpoint, apply the same host
   operation, and record propagation time again.
6. In the private terminal, keep the replacement in
   `MILLWORK_KIT_ENDPOINT_KEY` and load the removed current key into
   `MILLWORK_KIT_RETIRED_KEYS`. Prove direct rejection of the removed key:

   ```bash
   unset MILLWORK_KIT_OVERLAP_KEYS
   node check-endpoint.mjs \
     --deployed https://app.example/millwork-check \
     --authorize-endpoint-test \
     --check listing-example-check.mjs \
     --access authenticated --json
   ```

Keep the key values in the host secret manager and ephemeral shell environment.
Retained diagnostics may name the environment, URL, revision, runtime, status,
elapsed time and error code. They must not contain request candidates, response
free text, authorization headers, environment dumps, or key-derived values.

## Recovery

- `503 endpoint_keys_not_configured`: restore a non-empty endpoint-key variable.
- `503 endpoint_keys_misconfigured`: remove any Millwork account key from the
  endpoint setting and replace it with an endpoint-only key.
- `401 unauthorized`: confirm the active/overlap stage and test the intended key.
- `500`/`504`: fix the existing check or its latency; the adapter creates no
  verdict for a technical failure.
- a failed replacement does not require a source rollback: keep the current key
  configured, correct the replacement, and repeat the overlap test.
