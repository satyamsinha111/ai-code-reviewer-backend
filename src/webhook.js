/**
 * Webhook router: receives GitHub events, verifies signature, and dispatches by event type.
 */

import { createInstallationClient } from './githubClient.js';
import { reviewPullRequest } from './prService.js';

const SUPPORTED_ACTIONS = new Set(['opened', 'synchronize']);

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
 * POST /webhook handler: read x-github-event, handle pull_request (opened | synchronize).
 */
export async function handleWebhook(req, res) {
  const event = req.headers['x-github-event'];
  if (!event) {
    return res.status(400).json({ error: 'Missing x-github-event header' });
  }

  if (event !== 'pull_request') {
    return res.status(200).send('Ignored');
  }

  const payload = req.body;
  const action = payload.action;
  if (!SUPPORTED_ACTIONS.has(action)) {
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
