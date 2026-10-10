# Contributing to Chook Check API

## Prerequisites

- Node 24 (see `.nvmrc`)
- npm
- A Cloudflare account (only needed for deployment, not for local dev or tests)

## Setup

```bash
git clone https://github.com/Nevenit/chook-check-api.git
cd chook-check-api
npm ci --include=dev
```

## Local development

```bash
npm run dev
```

This starts `wrangler dev` against a local miniflare D1 instance — no Cloudflare account required.

## Testing

Use Node 24 (`nvm use` reads `.nvmrc`) and install locked dependencies with `npm ci --include=dev`. The test scripts set `NODE_ENV=test` even when the invoking shell uses production mode.

```bash
npm test                 # one-shot
npm run test:watch
```

Integration tests run against an in-memory D1 (via `@cloudflare/vitest-pool-workers`) so they exercise real SQL.

## Project structure

```
src/
  index.ts              Hono app + route registration
  routes/               One file per resource: observations, products, trends, contributor
  middleware/           Rate limiting
  db/queries.ts         Parameterised queries
  lib/
    aggregation.ts      median, promoFrequency, trendChange (pure functions)
    schemas.ts          Zod schemas for inputs
    types.ts            Shared types
migrations/             D1 migrations (numbered SQL files)
test/                   Vitest integration tests
```

## Adding a migration

```bash
wrangler d1 migrations create chook-check <descriptive_name>
```

Edit the new file, then apply:

```bash
wrangler d1 migrations apply chook-check          # local
wrangler d1 migrations apply chook-check --remote # production
```

Never edit a previously-applied migration. Add a new one.

## Pull requests

- Run `npm test` before pushing
- New endpoints: add a route file under `src/routes/`, register in `src/index.ts`, add a Zod schema, add tests
- Schema changes: add a migration; don't edit existing SQL
- Privacy-affecting changes (anything that could log IP, store new identifying data, etc.) must be called out in the PR description

## License

By contributing you agree your contributions will be licensed under AGPL-3.0.
