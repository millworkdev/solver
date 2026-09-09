# @millwork/solver

TypeScript client for Millwork Solver.

## Install

```bash
npm install @millwork/solver
```

`npm install @millwork/solver` resolves the `latest` dist-tag. Pin an exact
version for reproducible application builds.

## CLI

Start the complete terminal setup with one command:

```bash
npx --yes @millwork/solver tenant start
```

First [configure your organization's Millwork API key](https://docs.getmillwork.dev/get-started/tenant-start#configure-your-api-key)
as `SOLVERAPI_API_KEY` in the terminal where you will run Millwork. Reuse a key
you saved or create one in [API keys](https://app.getmillwork.dev/keys).
`millwork doctor --json` checks this terminal without contacting the API.
A passing local check does not verify the key or account access.

To use your own provider account, add `--template byok-open-model` to the
setup command. Choose from the providers and models offered to your
organization. OpenRouter uses browser approval; other enabled providers use
Millwork's private key-entry page. Keep provider keys and approval codes out
of the terminal and conversation. Return to the terminal where you started.

Review each plan's effects, model, payer, platform fee, model budget and time
limit. A funded Millwork-model plan can include the free test and paid run in
one approval. Connecting your own provider account asks separately before
its paid run. A model call already running can exceed its budget.

Keep the application ID and the printed inspection and continuation commands.
Use inspection to read progress and continuation when you are ready to proceed.
If the browser cannot open here, use the private link on your browser device.
The [CLI guide](https://docs.getmillwork.dev/get-started/tenant-start) covers
expired links, interrupted setup, funding and failed runs. A completed setup
retains its answer and receipt; continuing it does not repeat the paid run.

With the CLI installed, `millwork provider list` reads available providers
separately from existing connections. `provider connect <source-id>` starts
the guided journey and may reuse a connection. `provider rotate <connection-id>`
checks replacement access before switching. `provider disconnect <connection-id>`
shows affected models before disabling that connection and scheduling saved-key
removal. Follow [provider connection guidance](https://docs.getmillwork.dev/guides/connect-a-source)
for returned IDs, confirmations and recovery.

After setup, `millwork tenant show` reports the selected model and preset.
Use that preset with `millwork run --preset <id> --objective "<task>"` for
another task. To change models, read `millwork models list` and use the model
key and deployment ID from one row. Review the provider, payer and any paid
test before approving; a failed replacement preserves the prior selection.

`millwork --version --json` reports the installed version; `millwork docs`
links to the current guides. Read [API, SDK and MCP](https://docs.getmillwork.dev/guides/api-sdk-mcp)
for the available interfaces. A provider named in an example is not
necessarily available to your organization.

## Smallest working example

```ts
import { Solver, SolverApiError } from "@millwork/solver";

const solver = new Solver({
  apiKey: process.env.SOLVERAPI_API_KEY!,
  baseUrl: "https://api.getmillwork.dev/v1",
});

const { items } = await solver.arms.list();
console.log(items.length);
```

`baseUrl` stays explicit and the SDK never rewrites a caller-configured
origin. `https://api.getmillwork.dev/v1` is the documented production API
base; use the base and API key your administrator gives you. `bootstrapTenant`
is a tenant-provisioning call, not the first-run step; see the optional
section below.

## Status

- `arms`, `verifiers`, `apiKeys`, `executions`, `receipts`, `proposals`, and
  `usage` wrap the live backend routes when you supply a key and base URL.
- `executions.events()` polls with `after=<event_id>` and stops after a
  terminal execution lifecycle event. It does not invent a socket transport.
- Eligible live routes invoke the selected ready arm. Check the terminal result
  and receipt: a `running` status alone is not proof that a provider answered.

## Compatibility

Named support is Node 20 and Node 22. `engines.node` is `>=20`.
License is Apache-2.0.

## Errors

Non-2xx responses throw `SolverApiError` with the parsed Problem body
(`type`, `status`, `detail`, `instance`, `errors`, `retryAfterS`). Network or
unparseable bodies throw `SolverApiNetworkError`. Do not string-parse
`error.message`. Automatic retries apply only to safe reads and mutations that
already carry a caller-owned idempotency key.

## Optional: tenant bootstrap

`bootstrapTenant` creates a tenant and first API key in environments where
that provisioning route is enabled. For the hosted service, obtain your
organization's access and key through the dashboard. This function is not
an alternative when a local key is missing.

```ts
import { bootstrapTenant } from "@millwork/solver";

const tenant = await bootstrapTenant({
  baseUrl: "https://api.getmillwork.dev/v1",
  displayName: "Acme Corp",
});
```

## Release notes

See the version history on the
[npm package page](https://www.npmjs.com/package/@millwork/solver?activeTab=versions).
