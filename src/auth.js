/**
 * Authorization for MergeMonk: only GitHub accounts that have completed OAuth ("Sign in with GitHub")
 * can use the app. User details (email, name, etc.) are stored in the users collection;
 * installation records with authorized flag and user details are in active_users.
 */

import { getDB } from './db.js';
import { isUserAuthorized, getAuthorizedUser } from './githubAuth.js';

const ACTIVE_USERS_COLLECTION = 'active_users';

/**
 * Returns true if the installation is authorized to use MergeMonk.
 * An installation is authorized only if its account (user or org) has completed GitHub OAuth.
 * When MongoDB is not configured, all installations are allowed (backward compatible).
 * @param {number} installationId - GitHub installation id
 * @returns {Promise<boolean>}
 */
export async function isInstallationAuthorized(installationId) {
  const db = getDB();
  if (!db) return true;

  const doc = await db.collection(ACTIVE_USERS_COLLECTION).findOne(
    { installationId },
    { projection: { authorized: 1 } }
  );
  return doc?.authorized === true;
}

/**
 * Returns true if this GitHub account has completed OAuth (is in users collection).
 * @param {string} login - GitHub account login
 * @returns {Promise<boolean>}
 */
export async function isAccountAuthorized(login) {
  return isUserAuthorized(login);
}

/**
 * Gets stored user details (email, name, etc.) for an account. Returns null if not authorized.
 * @param {string} login - GitHub account login
 * @returns {Promise<{ login: string, email: string|null, name: string|null, avatarUrl: string|null }|null>}
 */
export async function getAuthorizedUserDetails(login) {
  return getAuthorizedUser(login);
}
