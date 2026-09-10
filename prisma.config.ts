import { defineConfig } from 'prisma/config';

// Prisma 7 does NOT auto-load .env (Prisma 6 did). Node built-in, no dotenv dependency.
// PRISMA_ENV_FILE lets `npm run migrate:test` target the test database without editing
// .env by hand, which the plan flagged as an awkward manual step.
const envFile = process.env.PRISMA_ENV_FILE ?? '.env';
try {
  process.loadEnvFile(envFile);
} catch {
  // No env file — fall back to real environment variables (CI, containers).
}

const {
  DATABASE_HOST = '127.0.0.1',
  DATABASE_PORT = '3306',
  DATABASE_USER = '',
  DATABASE_PASSWORD = '',
  DATABASE_NAME = '',
} = process.env;

// The migrate CLI accepts only a URL string, so credentials MUST be percent-encoded.
const user = encodeURIComponent(DATABASE_USER);
const pass = encodeURIComponent(DATABASE_PASSWORD);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: `mysql://${user}:${pass}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}`,
  },
});
