import { Pool } from "pg";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and configure it.");
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined
  });
}

export const pool = globalForPg.pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;

export async function query<T extends import("pg").QueryResultRow = import("pg").QueryResultRow>(
  text: string,
  values: unknown[] = []
) {
  return pool.query<T>(text, values);
}
