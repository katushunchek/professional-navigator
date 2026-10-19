import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(`INSERT INTO regions(name) VALUES ('Екатеринбург') ON CONFLICT (name) DO NOTHING`);
  console.log("Seed complete: region Екатеринбург");
} finally {
  await pool.end();
}
