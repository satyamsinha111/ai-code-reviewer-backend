/**
 * GitHub OAuth: "Sign in with GitHub" so users authorize MergeMonk.
 * Stores user profile and email in the DB. Only these users can use the app after installing it.
 */

import { getDB } from './db.js';

const USERS_COLLECTION = 'users';
const GITHUB_OAUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_USER = 'https://api.github.com/user';
const GITHUB_API_EMAILS = 'https://api.github.com/user/emails';

const SCOPES = ['read:user', 'user:email'];

function userDocId(login) {
  return `user:${(login || '').toLowerCase()}`;
}

/**
 * Redirects the user to GitHub OAuth.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function redirectToGitHub(req, res) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'GitHub OAuth not configured', message: 'GITHUB_CLIENT_ID is not set' });
  }
  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  const redirectUri = `${baseUrl}/auth/github/callback`;
  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
  });
  res.redirect(`${GITHUB_OAUTH_URL}?${params.toString()}`);
}

/**
 * Exchanges the OAuth code for an access token and fetches user profile + emails, then saves to DB.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleGitHubCallback(req, res) {
  const { code, state } = req.query;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  const redirectUri = `${baseUrl}/auth/github/callback`;

  if (!code || !clientId || !clientSecret) {
    return res.status(400).send('Missing code or OAuth not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and BASE_URL.');
  }

  let token;
  try {
    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }
    token = tokenData.access_token;
  } catch (err) {
    console.error('GitHub OAuth token exchange failed:', err.message);
    return res.status(502).send(`Authorization failed: ${err.message}`);
  }

  let user;
  let emails = [];
  try {
    const [userRes, emailsRes] = await Promise.all([
      fetch(GITHUB_API_USER, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(GITHUB_API_EMAILS, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    if (!userRes.ok) throw new Error(`User API: ${userRes.status}`);
    user = await userRes.json();
    if (emailsRes.ok) {
      emails = await emailsRes.json();
    }
  } catch (err) {
    console.error('GitHub API fetch failed:', err.message);
    return res.status(502).send(`Failed to load profile: ${err.message}`);
  }

  const primaryEmail = emails.find((e) => e.primary)?.email || emails[0]?.email || null;
  const login = user.login;
  if (!login) {
    return res.status(400).send('GitHub user has no login');
  }

  const db = getDB();
  if (!db) {
    return res.status(503).send('Database not available. Configure MONGODB_URI to save authorized users.');
  }

  const doc = {
    _id: userDocId(login),
    login: login.toLowerCase(),
    githubId: user.id,
    email: primaryEmail,
    name: user.name || null,
    avatarUrl: user.avatar_url || null,
    authorizedAt: new Date(),
  };

  try {
    await db.collection(USERS_COLLECTION).updateOne(
      { _id: doc._id },
      { $set: doc },
      { upsert: true }
    );
  } catch (err) {
    console.error('Failed to save user:', err.message);
    return res.status(500).send('Failed to save authorization.');
  }

  console.log(`Authorized user: ${login} (${primaryEmail || 'no email'})`);
  const successUrl = process.env.AUTH_SUCCESS_URL || `${baseUrl}/?authorized=1`;
  res.redirect(successUrl);
}

/**
 * Returns true if this GitHub login has completed OAuth (is in users collection).
 * @param {string} login - GitHub account login
 * @returns {Promise<boolean>}
 */
export async function isUserAuthorized(login) {
  const db = getDB();
  if (!db) return false;
  const doc = await db.collection(USERS_COLLECTION).findOne(
    { _id: userDocId(login) },
    { projection: { _id: 1 } }
  );
  return !!doc;
}

/**
 * Gets stored user details by login (email, name, etc.). Returns null if not found.
 * @param {string} login - GitHub account login
 * @returns {Promise<{ login: string, email: string|null, name: string|null, avatarUrl: string|null }|null>}
 */
export async function getAuthorizedUser(login) {
  const db = getDB();
  if (!db) return null;
  const doc = await db.collection(USERS_COLLECTION).findOne(
    { _id: userDocId(login) },
    { projection: { login: 1, email: 1, name: 1, avatarUrl: 1 } }
  );
  return doc ? { login: doc.login, email: doc.email ?? null, name: doc.name ?? null, avatarUrl: doc.avatarUrl ?? null } : null;
}
