export type DbCreds = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

function isProductionDeploy(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.CONTEXT === "production" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.AWS_SAM_LOCAL) ||
    process.cwd() === "/var/task"
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
  return parseCredentialsJson(raw);
}

function parseCredentialsJson(raw: string): DbCreds {
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

async function credentialsFileCandidates(): Promise<string[]> {
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const candidates: string[] = [];
  const explicitPath =
    process.env.NBS_DB_CREDENTIALS_FILE ?? process.env.DB_CREDENTIALS_FILE;
  if (explicitPath?.trim()) candidates.push(explicitPath.trim());

  candidates.push(join(process.cwd(), "dbcredentials"));

  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, "..", "..", "dbcredentials"));
  } catch {
    // Bundled runtimes may not expose import.meta.url.
  }

  return [...new Set(candidates)];
}

async function fromLocalCredentialsFile(): Promise<DbCreds | null> {
  if (isProductionDeploy()) return null;

  const { readFile } = await import("node:fs/promises");

  for (const filePath of await credentialsFileCandidates()) {
    try {
      const raw = await readFile(filePath, "utf8");
      return parseCredentialsJson(raw);
    } catch {
      continue;
    }
  }

  return null;
}

export async function loadDbCreds(): Promise<DbCreds> {
  const fromEnv = fromDiscreteEnv() ?? fromJsonEnv();
  if (fromEnv) return fromEnv;

  const fromFile = await fromLocalCredentialsFile();
  if (fromFile) return fromFile;

  throw new Error(
    "MySQL credentials missing. In production (Vercel/Lovable/Cloudflare) set NBS_DB_CREDENTIALS " +
      "(JSON) or NBS_DB_HOST / NBS_DB_PORT / NBS_DB_USER / NBS_DB_PASSWORD / NBS_DB_DATABASE. " +
      "Locally, place a dbcredentials JSON file in the project root.",
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
