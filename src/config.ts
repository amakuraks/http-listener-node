function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be an integer, got: ${raw}`);
  return parsed;
}

const engine = process.env.DATABASE_ENGINE ?? 'mysql';
if (engine !== 'mysql') {
  throw new Error(`DATABASE_ENGINE="${engine}" is not supported. MVP supports "mysql" only.`);
}

export const config = {
  db: {
    host: required('DATABASE_HOST'),
    port: int('DATABASE_PORT', 3306),
    user: required('DATABASE_USER'),
    // Password may legitimately be empty on a local dev database.
    password: process.env.DATABASE_PASSWORD ?? '',
    database: required('DATABASE_NAME'),
    connectionLimit: 5,
  },
  // Loopback by default (gate #O1). Binding to every interface must be deliberate:
  // this app has no auth and stores captured credentials in cleartext.
  host: process.env.HOST ?? '127.0.0.1',
  port: int('PORT', 3000),
  pageSize: int('PAGE_SIZE', 20),
  maxBodySize: process.env.MAX_BODY_SIZE ?? '50mb',
  bodyPreviewChars: int('BODY_PREVIEW_CHARS', 2000),
  bodyInlineMax: int('BODY_INLINE_MAX', 131072),
} as const;
