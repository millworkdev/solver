# @millwork/solver

TypeScript client for Millwork Solver.

## Install

```bash
npm install @millwork/solver
```

`npm install @millwork/solver` resolves the `latest` dist-tag. Pin an exact
version for reproducible installs. Pre-promotion versions are published under
the `candidate` dist-tag and are never installed by default.

## Smallest working example

```ts
import { Solver, SolverApiError } from "@millwork/solver";

const solver = new Solver({
  apiKey: process.env.SOLVER_API_KEY!,
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
- External arm dispatch remains a backend limitation. A ranked `running` arm is
  not proof that a provider was invoked.

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
