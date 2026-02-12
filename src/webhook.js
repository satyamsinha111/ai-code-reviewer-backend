/**
 * Webhook router: receives GitHub events, verifies signature, and dispatches by event type.
 */

import { createInstallationClient } from './githubClient.js';
import { reviewPullRequest } from './prService.js';
import { getDB } from './db.js';

const SUPPORTED_PR_ACTIONS = new Set(['opened', 'synchronize']);
const ACTIVE_USERS_COLLECTION = 'active_users';

/**
 * Placeholder middleware for webhook signature verification.
 * In production, verify using crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
 * and compare with x-hub-signature-256 header.
 */
export function verifyWebhookSignature(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn('WEBHOOK_SECRET not set; skipping signature verification');
    return next();
  }
  // TODO: implement with crypto.timingSafeEqual and x-hub-signature-256
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) {
    return res.status(401).json({ error: 'Missing signature' });
  }
  // Placeholder: real impl would verify sig === 'sha256=' + hmac(body)
  return next();
}

/**
 * Handle installation event: on "created", upsert the installer into active_users.
 */
async function handleInstallation(payload) {
  const action = payload.action;
  if (action !== 'created') {
    return;
  }
  const installation = payload.installation;
  if (!installation?.id) {
    return;
  }
  const db = getDB();
  if (!db) {
    return;
  }
  const account = installation.account || {};
  const repos = payload.repositories || [];
  const doc = {
    _id: installation.id,
    installationId: installation.id,
    accountLogin: account.login ?? null,
    accountType: account.type ?? null,
    avatarUrl: account.avatar_url ?? null,
    repositoryCount: Array.isArray(repos) ? repos.length : 0,
    installedAt: new Date(),
  };
  try {
    await db.collection(ACTIVE_USERS_COLLECTION).updateOne(
      { _id: installation.id },
      { $set: doc },
      { upsert: true }
    );
    console.log(`Active user recorded: installation ${installation.id} (${account.login ?? 'unknown'})`);
  } catch (err) {
    console.error('Failed to record active user:', err.message);
    throw err;
  }
}

/**
 * POST /webhook handler: read x-github-event, handle installation (created) and pull_request (opened | synchronize).
 */
export async function handleWebhook(req, res) {
  const event = req.headers['x-github-event'];
  if (!event) {
    return res.status(400).json({ error: 'Missing x-github-event header' });
  }

  const payload = req.body;

  if (event === 'installation') {
    await handleInstallation(payload);
    return res.status(200).json({ ok: true });
  }

  if (event !== 'pull_request') {
    return res.status(200).send('Ignored');
  }

  const action = payload.action;
  if (!SUPPORTED_PR_ACTIONS.has(action)) {
    return res.status(200).send('Ignored');
  }

  const { repository, installation, pull_request: pr } = payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const pullNumber = pr.number;
  const installationId = installation?.id;

  if (!installationId) {
    console.error('No installation id in webhook payload');
    return res.status(400).json({ error: 'Missing installation id' });
  }

  // Installation ID comes from the payload per request (different per repo/org); no need for .env
  const appId = process.env.APP_ID;
  const privateKey = process.env.PRIVATE_KEY;

  if (!appId || !privateKey) {
    console.error('APP_ID or PRIVATE_KEY not configured');
    return res.status(500).json({ error: 'App not configured' });
  }

  try {
    const octokit = createInstallationClient({
      appId,
      privateKey,
      installationId,
    });
    await reviewPullRequest(octokit, owner, repo, pullNumber);
    console.log(`Review posted for ${owner}/${repo}#${pullNumber}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Review failed:', err.message);
    return res.status(500).json({ error: 'Review failed', message: err.message });
  }
}
