export type DbCreds = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY ||
      process.cwd() === "/var/task",
  );
}

function fromDiscreteEnv(): DbCreds | null {
  const host = process.env.NBS_DB_HOST ?? process.env.DB_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.NBS_DB_PORT ?? process.env.DB_PORT ?? 6033),
    user: process.env.NBS_DB_USER ?? process.env.DB_USER ?? "",
    password: process.env.NBS_DB_PASSWORD ?? process.env.DB_PASSWORD ?? "",
    database: process.env.NBS_DB_DATABASE ?? process.env.DB_DATABASE ?? "cyclops",
  };
}

function fromJsonEnv(): DbCreds | null {
  const raw = process.env.NBS_DB_CREDENTIALS ?? process.env.DB_CREDENTIALS;
  if (!raw?.trim()) return null;
  const parsed = JSON.parse(raw) as {
    host: string;
    port: number | string;
    user: string;
    password: string;
    database: string;
  };
  return {
    host: parsed.host,
    port: Number(parsed.port),
    user: parsed.user,
    password: parsed.password,
    database: parsed.database,
  };
}

async function fromLocalCredentialsFile(): Promise<DbCreds | null> {
  if (isServerlessRuntime()) return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(join(process.cwd(), "dbcredentials"), "utf8");
    const parsed = JSON.parse(raw) as {
      host: string;
      port: number | string;
      user: string;
      password: string;
      database: string;
    };
    return {
      host: parsed.host,
      port: Number(parsed.port),
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
    };
  } catch {
    return null;
  }
}

export async function loadDbCreds(): Promise<DbCreds> {
  const fromEnv = fromDiscreteEnv() ?? fromJsonEnv();
  if (fromEnv) return fromEnv;

  const fromFile = await fromLocalCredentialsFile();
  if (fromFile) return fromFile;

  throw new Error(
    "MySQL credentials missing. On Vercel/production set NBS_DB_CREDENTIALS (JSON) " +
      "or NBS_DB_HOST / NBS_DB_PORT / NBS_DB_USER / NBS_DB_PASSWORD / NBS_DB_DATABASE. " +
      "Locally you can also use a dbcredentials file in the project root.",
  );
}

export async function withMysqlConnection<T>(
  fn: (conn: import("mysql2/promise").Connection) => Promise<T>,
  opts?: { database?: string },
): Promise<T> {
  const mysql = await import("mysql2/promise");
  const creds = await loadDbCreds();
  const conn = await mysql.createConnection({
    host: creds.host,
    port: creds.port,
    user: creds.user,
    password: creds.password,
    database: opts?.database ?? creds.database,
    connectTimeout: 30_000,
    dateStrings: true,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}
