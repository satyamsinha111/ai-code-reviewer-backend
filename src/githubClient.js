/**
 * GitHub API client using App authentication.
 * Creates an authenticated Octokit instance for the given installation.
 */

import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

/**
 * Creates an Octokit client authenticated as the GitHub App for a specific installation.
 * @param {object} options - { appId, privateKey, installationId }
 * @returns {Octokit} Authenticated Octokit instance
 */
export function createInstallationClient({ appId, privateKey, installationId }) {
  const privateKeyNormalized = privateKey.replace(/\\n/g, '\n');
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: privateKeyNormalized,
      installationId,
    },
  });
}
