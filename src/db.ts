import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from './generated/prisma/client.ts';
import { config } from './config.ts';

const adapter = new PrismaMariaDb({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
});

export const prisma = new PrismaClient({ adapter });
