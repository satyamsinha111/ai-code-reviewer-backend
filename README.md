# MergeMonk

GitHub App that automatically reviews pull requests. It comments on PRs when they are opened or updated (synchronize).

## Features

- Listens for `pull_request` events (actions: `opened`, `synchronize`) and `installation` (action: `created`)
- **Authorization:** users must complete **GitHub OAuth** (visit `/auth/github`) before they can use the app. Their **email**, name, and profile are stored in MongoDB. Only installs whose GitHub account has authorized get PR reviews.
- When MongoDB is configured, records each app installation in `active_users` (with `authorized`, `email`, `name`, etc.) and OAuth users in `users`.
- Fetches PR details and changed files via GitHub API
- **AI review (OpenAI):** when `OPENAI_API_KEY` is set, MergeMonk uses OpenAI for production-grade reviews:
  - **Summary** and **code quality rating** (1–10)
  - **Security** (secrets, validation, auth, injection, sensitive data)
  - **System design** (structure, coupling, boundaries, error handling)
  - **Scalability** (concurrency, bottlenecks, caching, resource use)
  - **Overall feedback** and **inline comments** on specific lines; each comment includes a **suggested prompt** to copy into Cursor (or another AI) to fix the issue
- **Fallback:** without OpenAI, uses rule-based review (e.g. warns on `console.log`)
- **Blocks merge until review is resolved:** posts the review as **Request changes** so the PR cannot be merged until someone with write access approves (after addressing feedback). Optional: repo branch protection can require conversation resolution too.
- Posts a single PR review (summary + rating + comments) using the GitHub App

## Setup

1. **Create a GitHub App** (GitHub → Settings → Developer settings → GitHub Apps → New GitHub App).
   - Set webhook URL to your deployed URL (e.g. `https://your-app.railway.app/webhook`) and optionally a secret.
   - Under **Permissions & events**, subscribe to **Installation** (and **Pull requests**) so the app receives `installation` and `pull_request` webhooks.
   - Note the **App ID**.
   - Generate a **Private key** and download it.
   - Install the app on a repo/org (the installation ID is sent with each webhook, so you don’t need to set it in .env).

2. **Clone and install**

   ```bash
   cd backend
   npm install
   ```

3. **Configure environment**

   Copy `.env.example` to `.env` and set:

   - `APP_ID` – GitHub App ID
   - `PRIVATE_KEY` – Full contents of the `.pem` file (multiline; escape newlines as `\n` or use quotes)
   - `WEBHOOK_SECRET` – Same secret as in the GitHub App webhook (optional; enables signature verification when implemented)
   - `OPENAI_API_KEY` – OpenAI API key (optional; if set, AI review with summary and quality rating is used)
   - `OPENAI_MODEL` – Optional; defaults to `gpt-4o-mini` (use `gpt-4o` for deeper security/design/scalability reviews)
   - `MERGEMONK_REQUEST_CHANGES` – Optional; default `true`. Set to `false` to post review as comment only (no merge block).
   - **GitHub OAuth** (for authorization): create an OAuth App at GitHub → Developer settings → OAuth Apps. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `BASE_URL` (e.g. `https://your-app.railway.app`). Users visit `BASE_URL/auth/github` to authorize; their email and profile are saved to MongoDB. Only authorized accounts can use the app after installing it.
   - `PORT` – Server port (default 3000; Railway sets this)

   Installation ID is taken from each webhook payload (`installation.id`), so it does not need to be set in .env and works for every repo/org where the app is installed.

4. **Authorization flow**

   Users must authorize with GitHub before their installation can use MergeMonk:

   - Create a **GitHub OAuth App** (Developer settings → OAuth Apps), set Authorization callback URL to `BASE_URL/auth/github/callback`.
   - Users visit `BASE_URL/auth/github` and sign in with GitHub; their **email**, name, and profile are stored in the `users` collection.
   - When they install the MergeMonk GitHub App, the installation is linked to their account; their email/name are copied into `active_users` and `authorized` is set to true. Only then will PR webhooks be processed.

5. **Run locally**

   ```bash
   npm start
   ```

   Or with auto-reload:

   ```bash
   npm run dev
   ```

## API

- `GET /` – JSON app name and status
- `GET /health` – 200 ok
- `GET /auth/github` – Redirects to GitHub OAuth to authorize (store user email/details in DB)
- `GET /auth/github/callback` – OAuth callback; do not call directly
- `POST /webhook` – GitHub webhook; handles `installation` (created → records in `active_users` with email/details) and `pull_request` (opened, synchronize; only for authorized installations)

## Deploy to Railway

1. Create a new project and connect this repo (or deploy from CLI).
2. Add the same environment variables in the Railway dashboard (Variables).
3. For `PRIVATE_KEY`, paste the PEM content; Railway supports multiline. Alternatively use a single line with `\n` for newlines.
4. Railway runs `npm install` and `npm start` by default, so no extra config is needed.

Ensure the GitHub App webhook URL points to your Railway URL, e.g. `https://<your-project>.up.railway.app/webhook`.

## Blocking merges until reviews are resolved

MergeMonk posts its review with **Request changes** by default, so:

1. The PR cannot be merged until someone with write access **approves** it (after the author addresses the review).
2. To also require that **all review comment threads are resolved** before merge, repo admins should enable branch protection:
   - **Settings → Branches → Branch protection rules** (e.g. for `main`)
   - Enable **Require a pull request before merging**
   - Enable **Require conversation resolution before merging** (so every inline comment thread must be resolved)
   - Optionally require status checks or a number of approvals

Set `MERGEMONK_REQUEST_CHANGES=false` in your environment if you want MergeMonk to only comment without requesting changes (no merge block).

## Project structure

```
/src
  server.js       – Express app, routes (/, /health, /auth/github, /webhook)
  webhook.js      – POST /webhook, installation + pull_request handler, active_users upsert
  githubAuth.js   – GitHub OAuth (redirect, callback), store user email/profile in users collection
  auth.js         – isInstallationAuthorized, isAccountAuthorized (OAuth-based)
  githubClient.js – createInstallationClient (Octokit + auth-app)
  prService.js    – fetch PR + files, runAIReview or runReview, createReview
  reviewEngine.js – runAIReview (OpenAI), runReview (rule-based fallback)
  openaiService.js – getAIReview (summary, quality rating, review body, inline comments)
  diffUtils.js    – parse patches, map (path, line) to (path, position) for GitHub review API
  db.js           – MongoDB connect, getDB, validate MONGODB_URI
.env.example
package.json
README.md
```

## Security

- Webhook signature verification is scaffolded in `webhook.js` (`verifyWebhookSignature`). For production, verify `x-hub-signature-256` using the raw body and `WEBHOOK_SECRET` with HMAC-SHA256.
- Keep `PRIVATE_KEY`, `WEBHOOK_SECRET`, `GITHUB_CLIENT_SECRET`, and `OPENAI_API_KEY` in environment variables only; never commit them.
