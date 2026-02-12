/**
 * MongoDB connection for MergeMonk. Connect once, reuse the client.
 */

import { MongoClient } from 'mongodb';

let client = null;
let db = null;

const VALID_PROTOCOLS = new Set(['mongodb:', 'mongodb+srv:']);

/**
 * Validates MONGODB_URI format. Throws if invalid.
 * @param {string} uri - The connection string to validate.
 * @throws {Error} If the URI is not a valid MongoDB connection string.
 */
export function validateMongoDBUri(uri) {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new Error('MONGODB_URI must be a non-empty string');
  }
  const trimmed = uri.trim();
  try {
    const parsed = new URL(trimmed);
    if (!VALID_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(
        `MONGODB_URI must use scheme mongodb or mongodb+srv, got: ${parsed.protocol.replace(/:$/, '')}`
      );
    }
    if (!parsed.hostname) {
      throw new Error('MONGODB_URI must include a host');
    }
    if (parsed.protocol === 'mongodb+srv:' && parsed.port) {
      throw new Error('mongodb+srv URIs must not include a port');
    }
  } catch (err) {
    if (err instanceof TypeError && err.code === 'ERR_INVALID_URL') {
      throw new Error(`MONGODB_URI is not a valid URL: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Connect to MongoDB using MONGODB_URI. Safe to call multiple times; reuses existing connection.
 * @returns {Promise<import('mongodb').Db|null>} The database instance, or null if MONGODB_URI is not set.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('MONGODB_URI not set; DB features disabled');
    return null;
  }
  validateMongoDBUri(uri);
  if (client) return db;
  client = new MongoClient(uri);
  try {
    await client.connect();
  } catch (err) {
    client = null;
    throw new Error(`MongoDB connection failed: ${err.message}`, { cause: err });
  }
  db = client.db();
  console.log('MongoDB connected');
  return db;
}

/**
 * Get the current database instance (must have called connectDB() first).
 * @returns {import('mongodb').Db|null}
 */
export function getDB() {
  return db;
}

/**
 * Close the MongoDB connection. Call on process shutdown if needed.
 */
export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
