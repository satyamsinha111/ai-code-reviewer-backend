# MergeMonk – Setup Guide

Follow these steps in order.

---

## 1. MongoDB

You need a MongoDB database (required for authorization and storing user email/details).

- **Option A – Local:** Install MongoDB and use `mongodb://localhost:27017/mergemonk`
- **Option B – Atlas:** Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas), create a database user, get the connection string (e.g. `mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net/mergemonk?retryWrites=true&w=majority`)

You’ll put this in `.env` as `MONGODB_URI` in step 5.

---

## 2. Create the GitHub App (for PR reviews)

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Fill in:
   - **Name:** e.g. MergeMonk
   - **Homepage URL:** your app URL (e.g. `https://your-app.railway.app` or `http://localhost:3000` for local)
   - **Webhook URL:** `https://YOUR-DOMAIN/webhook` (e.g. `https://your-app.railway.app/webhook` or `https://xxxx.ngrok.io/webhook` for local)
   - **Webhook secret:** Generate a random string and save it (you’ll use it as `WEBHOOK_SECRET`)
3. Under **Permissions & events:**
   - **Repository permissions:** set **Contents** to Read and write, **Pull requests** to Read and write.
   - **Subscribe to events:** check **Installation** and **Pull requests**.
4. Create the app, then:
   - Note the **App ID** (e.g. `123456`).
   - Click **Generate a private key** and download the `.pem` file. You’ll use its contents as `PRIVATE_KEY`.

---

## 3. Create the GitHub OAuth App (for “Sign in with GitHub”)

This is separate from the GitHub App above. It’s used so users can authorize MergeMonk and have their email/profile stored.

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in:
   - **Application name:** e.g. MergeMonk Auth
   - **Homepage URL:** same as in step 2 (e.g. `https://your-app.railway.app` or `http://localhost:3000`)
   - **Authorization callback URL:** `https://YOUR-DOMAIN/auth/github/callback`  
     Examples:
     - Production: `https://your-app.railway.app/auth/github/callback`
     - Local: `http://localhost:3000/auth/github/callback`
3. Register the app, then note the **Client ID** and generate a **Client secret**. You’ll use them as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

---

## 4. (Optional) OpenAI

For AI-powered reviews, create an API key at [platform.openai.com](https://platform.openai.com) and set `OPENAI_API_KEY` in `.env`. If you don’t set it, MergeMonk uses a simple rule-based review only.

---

## 5. Configure `.env`

In the project root (backend folder):

```bash
cp .env.example .env
```

Edit `.env` and set at least:

| Variable | Where to get it |
|----------|------------------|
| `APP_ID` | GitHub App (step 2) – App ID |
| `PRIVATE_KEY` | Contents of the `.pem` file from step 2. Paste the whole block including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`. For a single line, replace real newlines with `\n`. |
| `WEBHOOK_SECRET` | The webhook secret you set in the GitHub App (step 2) |
| `GITHUB_CLIENT_ID` | OAuth App (step 3) – Client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App (step 3) – Client secret |
| `BASE_URL` | Full URL of your app with no trailing slash, e.g. `https://your-app.railway.app` or `http://localhost:3000` |
| `MONGODB_URI` | Your MongoDB connection string (step 1) |
| `PORT` | Optional; default `3000` |

Optional:

- `OPENAI_API_KEY` – for AI reviews
- `AUTH_SUCCESS_URL` – where to send users after OAuth (default: `BASE_URL/?authorized=1`)

Example for **local** development:

```env
APP_ID=123456
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...paste key lines...
-----END RSA PRIVATE KEY-----"
WEBHOOK_SECRET=your_webhook_secret
GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_SECRET=your_oauth_client_secret
BASE_URL=http://localhost:3000
MONGODB_URI=mongodb://localhost:27017/mergemonk
PORT=3000
```

For **local**, your GitHub App webhook URL and OAuth callback URL must be reachable by GitHub. Use a tunnel (e.g. [ngrok](https://ngrok.com)) and set `BASE_URL` to the ngrok URL (e.g. `https://abc123.ngrok.io`), and use that same base for the webhook URL and callback URL in the GitHub App and OAuth App.

---

## 6. Run the app

```bash
npm install
npm start
```

You should see something like: `MongoDB connected` and `MergeMonk listening on port 3000`.

---

## 7. User flow (how it works for your users)

1. **Authorize first:** User opens **`BASE_URL/auth/github`** in a browser and signs in with GitHub. MergeMonk stores their email and profile in MongoDB and marks them as authorized.
2. **Install the app:** The same user (or org admin) installs the **MergeMonk GitHub App** on a repo/org from GitHub.
3. **PR reviews:** When they open or update a PR, MergeMonk only runs the review if that installation is linked to an authorized account (the one that did step 1). Otherwise the webhook returns 403 and the body includes `authorizeUrl` so they can complete step 1.

So: **authorize at `/auth/github` first, then install the GitHub App.** If someone installs the app without authorizing, their PRs won’t be reviewed until they visit `/auth/github`.

---

## 8. Deploy (e.g. Railway)

1. Create a new project and connect this repo.
2. Add the same environment variables from step 5 in the Railway dashboard (Variables).
3. Set `BASE_URL` to your Railway URL (e.g. `https://your-project.up.railway.app`).
4. In the **GitHub App** and **OAuth App** settings, set:
   - Webhook URL → `https://your-project.up.railway.app/webhook`
   - OAuth callback URL → `https://your-project.up.railway.app/auth/github/callback`

After deploy, users should use your production `BASE_URL` (e.g. `https://your-project.up.railway.app/auth/github`) to authorize.
