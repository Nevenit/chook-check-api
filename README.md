# Chook Check API

Privacy-thresholded community price-data backend for the [Chook Check](https://github.com/Nevenit/Chook-Check) browser extension. It runs as a Cloudflare Worker with D1 storage.

The API accepts authenticated pseudonymous observations from users who explicitly opt in, exposes only aggregated product data, and produces cautious signals for persistent matched price differences. It does not establish retailer intent or prove personalisation.

## Status

API v2, authentication, strict schemas, rate limiting, raw-data expiry, long-term daily aggregates, snapshot caching, and integration tests are implemented. The repository should not be treated as production-ready until the target D1 migrations and required Worker secrets have been applied and the deployed extension/API pair has passed release QA.

The unauthenticated v1 submission, product, trend, and UUID-only deletion routes are retired and return HTTP 410.

## API v2

| Method   | Path                                | Authentication           | Purpose                                                                               |
| -------- | ----------------------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `POST`   | `/api/v2/contributors`              | Registration rate limit  | Issue a contributor ID plus separate submit/deletion tokens.                          |
| `POST`   | `/api/v2/observations`              | `Bearer <submitToken>`   | Submit 1–50 version-2 observations in `history` or `fairness` mode.                   |
| `DELETE` | `/api/v2/contributor`               | `Bearer <deletionToken>` | Delete raw observations associated with that contributor and disable its credentials. |
| `GET`    | `/api/v2/products/:productId/stats` | Public read rate limit   | Get thresholded history and differential/observer-effect output.                      |
| `GET`    | `/api/v2/snapshots/products`        | Public read rate limit   | Get one cacheable bulk product snapshot with `ETag`.                                  |
| `GET`    | `/health`                           | None                     | Basic health response.                                                                |

Request schemas are in `src/lib/schemas.ts`; response types are in `src/lib/types.ts`. The observation schema is strict, rejects unknown fields such as `pageUrl`, requires the product prefix to match the retailer, and limits client timestamps to the previous 14 days.

### Authentication model

Registration returns three random values:

- `contributorId`: pseudonymous identifier attached to raw observations;
- `submitToken`: authorizes observation submission; and
- `deletionToken`: separately authorizes raw-data deletion.

D1 stores SHA-256 token hashes, never the raw tokens. A contributor ID alone is not submission or deletion authority. Contributions are pseudonymous rather than anonymous because raw rows from the same install remain linkable during the raw-retention period.

## Contribution modes

`history` mode accepts product/catalogue, price, offer, source, extraction, scraper, and time fields. Fairness-only context, browser family, and inline-instrument fields must be `null`, `unknown`, or the silent baseline values.

`fairness` mode requires a coarse store or region and can additionally contain fulfilment, sign-in, loyalty eligibility, browser family, and instrument/capture context. It does not accept account identifiers, precise location, or page URLs.

## Public aggregation and interpretation

- A product needs at least five distinct contributors before prices are public.
- Samples are balanced to one observation per contributor/product/day.
- Daily values use the median and include minimum/maximum values.
- The current value comes from the latest represented day, not the entire lookback period.
- Incoming extreme outliers are quarantined only after five comparable same-product/day/offer values exist; the bounds are below one-fifth or above five times that median.
- Quarantined values are excluded from public results.

A `possible_differential_pricing` result requires at least ten contributors in a fully matched cohort, at least three contributors in each of two or more price groups, and the same pattern in two hourly buckets. Matching includes store/region, fulfilment, offer, required quantity, source surface, instrument/capture mode, sign-in state, and loyalty state. Known sign-in/loyalty groups with different medians are labelled `contextual_difference` rather than unexplained personalisation.

Inline pre/post pairs are kept separate from silent observations. Observer-effect output requires five contributors with complete pairs. Every signal is evidence for review, not causal proof.

The extension repository contains the detailed [measurement methodology](https://github.com/Nevenit/Chook-Check/blob/main/docs/METHODOLOGY.md) and [threat model](https://github.com/Nevenit/Chook-Check/blob/main/docs/THREAT_MODEL.md).

## Privacy and retention

- Application code does not write raw IP addresses to D1 or associate an IP with an observation.
- Cloudflare necessarily receives source IPs and request metadata while serving traffic and may retain infrastructure/security logs under its own policies.
- Public-read and registration limits store a secret-keyed HMAC of the source IP. Registration rows expire after approximately 26 hours; other rate-limit rows expire after approximately two hours.
- Authenticated submission/deletion limits use the pseudonymous contributor ID and expire after approximately two hours.
- Raw v2 observations and their contributor links are retained for approximately 180 complete days.
- Before raw expiry, product-days are materialized only if at least five contributors are present. The daily record contains product metadata, date, median/minimum/maximum, and counts—no contributor IDs.
- Thresholded daily aggregates are retained for up to three years. Below-quorum days are deleted without an aggregate.

Deleting a contributor removes raw rows still linked to that contributor. It cannot reverse a non-attributable daily aggregate after raw rows have expired because the aggregate no longer contains individual rows or contributor identifiers.

The service contains no analytics or advertising SDK. Public aggregate responses may be read and republished by API clients.

## Abuse resistance and limitations

Registration is limited to three attempts per 24 hours per HMAC-pseudonymized IP key. Authenticated submissions are limited to 60 requests/hour per contributor, deletion to five requests/hour, and public reads to 120 requests/hour per IP key.

These controls raise the cost of Sybil submissions; they do not eliminate coordinated clients, residential proxies, stolen tokens, plausible fabricated values, unobserved offer conditions, or biased/self-selected participation. Do not represent API output as an authoritative retailer feed or a legal conclusion.

## Local development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run format:check
npm test
```

Create an uncommitted `.dev.vars` file for local Worker development:

```dotenv
RATE_LIMIT_SECRET=replace-with-a-long-random-development-secret
ALLOWED_EXTENSION_ORIGINS=
```

Tests use isolated Cloudflare Worker runtimes and an in-memory D1 database, including clean migration tests.

## Deployment

The Worker fails closed for IP-based rate-limited endpoints if `RATE_LIMIT_SECRET` is missing. Configure it before deployment; do not put the value in `wrangler.toml` or source control.

```bash
npm ci
npx wrangler secret put RATE_LIMIT_SECRET
npx wrangler d1 migrations apply chook-check --remote
npm run deploy
```

`RATE_LIMIT_SECRET` should be a long cryptographically random value. `ALLOWED_EXTENSION_ORIGINS` is an optional comma-separated secret/variable for explicitly configured extension origins. Chrome and Firefox extension-scheme origins are accepted by the current CORS policy, but CORS is not an authentication control; write endpoints still require their bearer token.

Production deployment is triggered only by `v*` tags and requires the `CLOUDFLARE_API_TOKEN` GitHub secret. The deployment workflow runs install, lint, type checking, formatting, and all tests, applies pending D1 migrations, and then runs `wrangler deploy`.

Never edit a migration already applied to a real environment. Add a new numbered migration for subsequent schema changes.

## Architecture

- [Hono](https://hono.dev) request routing.
- [Zod](https://zod.dev) strict validation.
- Cloudflare Workers and D1.
- Hourly scheduled cleanup for rate-limit rows, raw observation materialization/expiry, and aggregate expiry.
- Vitest with `@cloudflare/vitest-pool-workers` for real query/route integration tests.
- AGPL-3.0-only licensing.

## License and contributing

[AGPL-3.0-only](LICENSE). Operators who run a modified network service must meet the AGPL source-availability requirements.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance.
