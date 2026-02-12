/**
 * MergeMonk – GitHub App backend.
 * Express server; POST /webhook handles GitHub pull_request events and posts reviews.
 */

import 'dotenv/config';
import express from 'express';
import { verifyWebhookSignature, handleWebhook } from './webhook.js';
import { connectDB, closeDB } from './db.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// GitHub sends JSON payloads; we need raw body for signature verification.
// For a placeholder verification we parse JSON first; in production use express.raw() for /webhook and verify before parsing.
app.use(express.json());

// Health check for Railway and load balancers
app.get('/', (req, res) => {
  res.json({ name: 'MergeMonk', status: 'ok' });
});

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// Webhook endpoint: verify signature (scaffold), then handle event
app.post('/webhook', verifyWebhookSignature, (req, res) => {
  handleWebhook(req, res).catch((err) => {
    console.error('Webhook handler error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });
});

async function start() {
  await connectDB();
  const server = app.listen(PORT, () => {
    console.log(`MergeMonk listening on port ${PORT}`);
  });

  const shutdown = async () => {
    server.close(() => {
      closeDB().then(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
