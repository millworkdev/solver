# @millwork/solver

TypeScript client for Millwork Solver.

## Install

```bash
npm install @millwork/solver
```

`npm install @millwork/solver` resolves the `latest` dist-tag. Pin an exact
version for reproducible installs. Pre-promotion versions are published under
the `candidate` dist-tag and are never installed by default.

## CLI

The candidate release includes the `millwork` executable. Pin the candidate
version explicitly while `latest` remains on the bootstrap release:

```bash
npx --yes @millwork/solver@0.1.3 tenant start
```

`millwork doctor` checks the local Node, API base, and API-key configuration
without printing the credential. `millwork tenant start` inspects a plan before
any application or paid execution is approved.

Set `SOLVERAPI_API_KEY` to your organization's Millwork API key before starting;
do not put the key in command-line arguments. The hosted path supplies provider
access. To connect your own provider account, add `--template byok-open-model`:
the command opens your browser and waits for approval, then continues in the
same terminal. You never paste a provider key or authorization code there.

If approval fails or expires, the interactive command offers one explicit fresh
approval on the same saved setup. Declining makes no new connection or paid
request. JSON and headless output never prompts or retries consent implicitly.
The command prints its recovery command and retains a completed result/receipt;
recovery does not repeat that paid run. Current access and release guidance is
available through `millwork docs`.

`--version` reports the installed version, not the registry's current tags.
Its JSON report and `doctor` link to current support information instead of
embedding a public-availability claim that could become stale. These two reports
use schema version 2: `support_information_url` replaces the old
`supported_public_version` and `public_cli_available` fields. The `docs` report
and tenant-setup output keep their existing schemas.

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

`bootstrapTenant` creates a tenant and first API key. Use it after the
quickstart, not as the first line.

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
