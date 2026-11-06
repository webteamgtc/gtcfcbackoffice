import 'server-only';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set');

// reuse one client across hot reloads in dev and across requests in prod
const globalForMongo = globalThis;

function connect() {
  // drop a failed connection attempt so the next request retries instead of reusing the rejection
  const promise = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 }).connect().catch((err) => {
    if (globalForMongo._mongoClientPromise === promise) globalForMongo._mongoClientPromise = undefined;
    throw err;
  });
  return promise;
}

export async function getDb() {
  globalForMongo._mongoClientPromise ??= connect();
  const client = await globalForMongo._mongoClientPromise;
  return client.db(process.env.MONGODB_DB || 'new_crm');
}
