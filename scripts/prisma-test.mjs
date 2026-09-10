/**
 * Runs the Prisma CLI against the TEST database.
 *
 * `PRISMA_ENV_FILE=.env.testing prisma ...` would work in bash but not in cmd or
 * PowerShell, and npm runs scripts through cmd on Windows. Spawning with an augmented
 * environment is the portable equivalent.
 *
 *   node scripts/prisma-test.mjs migrate deploy
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['prisma', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PRISMA_ENV_FILE: '.env.testing' },
});

process.exit(result.status ?? 1);
