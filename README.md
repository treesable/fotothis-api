# fotothis-api

Species ID for the FotoThis iPhone app: Pl@ntNet names the plant, Groq writes facts about it.
The server never decides an unlock (the app does every check on the phone) and stores no photos
and no accounts.

## Endpoints

| Endpoint | What it does |
| --- | --- |
| `GET /api/health` | What's configured (true/false, never the values). Open it in a browser after a deploy. |
| `POST /api/v1/challenge` | One-time App Attest challenge (5 min). |
| `POST /api/v1/attest` | `{ keyId, attestation, challenge }`: registers the app's Secure Enclave key once per install. |
| `POST /api/v1/identify` | `{ image: base64 JPEG, lat?, lng?, lang? }` → `{ species, facts, remainingToday }`, or `429 { queued: true }` over the trial cap. |

Every request needs `x-api-secret`. `identify` also takes `x-device-id`, `x-app-attest-key-id` +
`x-app-attest-assertion` (signature over the exact body bytes) and `x-transaction-id` (App Store).

## Rules

- Plants only: the app calls `identify` only when Vision saw a plant. Moment facts (sky, rocks,
  water) are built into the app.
- Cap per device per UTC day: trial 3 (`TRIAL_DAILY_IDS`), paid unlimited, asked from Apple's
  App Store Server API, never trusted from the app. An unsure match (score < 0.2) or an error
  doesn't use one up.
- Facts are cached per species and language (one Groq call per species, ever).
- App Attest: `APP_ATTEST_MODE=log` checks and logs; `enforce` refuses requests that fail.

## Setup

1. Vercel → this project → Settings → Environment Variables: everything in `.env.example`.
2. Vercel → Storage → Upstash Redis (free) → connect to this project. Without it the caps and
   App Attest keys live in memory and don't hold.
3. Deploy (push to `main`), then open `/api/health`.

Local: `cp .env.example .env`, fill it in, `npx vercel dev`. Tests: `npm test` (Node 20+, no
dependencies).

The Pl@ntNet regional lookup and the facts prompt were copied from ReelNature's backend; nothing
is shared with it at runtime.
