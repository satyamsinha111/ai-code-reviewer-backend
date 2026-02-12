/**
 * MongoDB connection for MergeMonk. Connect once, reuse the client.
 */

import { MongoClient } from 'mongodb';

let client = null;
let db = null;

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
  if (client) return db;
  client = new MongoClient(uri);
  await client.connect();
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
