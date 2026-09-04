# Funding Desk V6 — clean Netlify rebuild

This package is a clean rebuild for `funding.weareunedited.com`. It uses Netlify’s current native application stack:

- Vite static frontend
- modern Netlify Functions (`export default` handlers)
- Netlify Identity via `@netlify/identity`
- Netlify Database with an automatically applied migration
- Netlify Blobs for private file storage
- OpenAI Responses API web search for cited funder research

There is no custom pre-build script, workspace policy file or legacy Lambda handler.

## Deploy exactly this way

The ZIP is source code and must be built by Netlify. Do not use Netlify Drop, because drag-and-drop deploys do not build server functions.

### Recommended: private Git repository

1. Unzip `funding-desk-v6.zip`.
2. Put the **contents** of the unzipped folder at the root of a private GitHub repository. `package.json` and `netlify.toml` must be visible at the repository root, not inside another `funding-desk-v6` directory.
3. In Netlify, choose **Add new project → Import an existing project** and select that repository.
4. Netlify should read these settings from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
   - Node: `22`
5. Deploy the project.

### Alternative: Netlify CLI

From inside the unzipped folder:

```bash
npm install
npx netlify login
npx netlify link
npx netlify deploy --build --prod
```

## Netlify setup after the first successful build

### 1. Database

Open **Data & Storage → Database** and create the database if Netlify has not provisioned it automatically. Because `@netlify/database` is installed and the schema is in `netlify/database/migrations/0001_funding_desk.sql`, Netlify applies the migration before publishing. `NETLIFY_DB_URL` is created automatically; do not copy a database password into browser code.

If the current account is not on a Netlify credit-based plan, Netlify Database will not be available. Upgrade or replace it with a Postgres connection before continuing.

### 2. Identity

1. Open **Project configuration → Access & security → Identity** and enable Identity.
2. Set registration to **Invite only**.
3. Invite `bernard@weareunedited.com` and the second user.
4. Give each user exactly one role: `owner`, `editor`, or `contributor`.
5. Sign out and back in after changing a role so the new role is included in the session.

Every write is checked inside the modern Netlify Function. Contributors cannot change scores, ownership or go/no-go decisions.

### 3. Environment variables

Open **Project configuration → Environment variables** and add:

| Variable | Required | Purpose |
|---|---:|---|
| `OPENAI_API_KEY` | For research | Current project API key beginning `sk-` |
| `OPENAI_MODEL` | Recommended | `gpt-5-mini` |
| `APP_BASE_URL` | Yes | `https://funding.weareunedited.com` |
| `RESEND_API_KEY` | For alerts | Resend API key |
| `ALERT_FROM_EMAIL` | For alerts | Verified sender such as `Funding Desk <funding@weareunedited.com>` |
| `RADAR_RECIPIENTS` | For Radar | Comma-separated recipient addresses |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | For calendar | Apps Script, Make or Zapier HTTPS endpoint |
| `CALENDAR_WEBHOOK_SECRET` | For calendar | Long random shared secret |

`NETLIFY_DB_URL` is managed by Netlify Database. Never set `DEV_AUTH_BYPASS` in production.

### 4. Domain

Under **Domain management**, add `funding.weareunedited.com`, create the CNAME requested by Netlify, and wait for HTTPS to become active.

### 5. Redeploy after configuration changes

Choose **Deploys → Trigger deploy → Clear cache and deploy site**. Then check:

```text
https://funding.weareunedited.com/api/health
```

The response shows readiness flags without exposing secret values.

## Included workflows

- Cited live-funder research with `last_checked_at`
- Opportunity pipeline, five-part scoring and go/no-go controls
- Project and evidence library
- Guidance/budget uploads to Netlify Blobs (4 MB maximum)
- Role enforcement and transactional audit trail
- Assignment emails using Resend
- Signed Google Calendar deadline hook
- Server-generated Word and PDF exports
- Weekly Radar at 08:00 UTC every Monday

## Local checks

```bash
npm install
npm test
npm run build
```

Local authenticated/database development requires `netlify dev`. The ordinary Vite preview deliberately shows representative sample data only on `localhost`; it never writes that sample data to production.

## Calendar webhook

Deadline changes send `opportunity.deadline.updated` JSON with an `x-funding-desk-signature` HMAC-SHA256 header. The receiver must verify the raw body using `CALENDAR_WEBHOOK_SECRET` and use the opportunity ID as an idempotency key.

## Diagnosing deployment failures

The final “Build script returned non-zero code” line is only a summary. The meaningful cause is normally 10–30 lines above it. This rebuild removes the two previous structural failure points: the malformed package-manager workspace file and the non-discoverable database migration location.
