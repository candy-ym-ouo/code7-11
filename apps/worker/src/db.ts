import pg from "pg";
import { config } from "./config";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30_000
});

pool.on("error", (error) => {
  console.error({ error }, "unexpected PostgreSQL pool error");
});
