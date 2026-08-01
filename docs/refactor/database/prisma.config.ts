import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// The real server bootstrap may import `dotenv/config` for local development.
// CI and production inject DATABASE_URL directly into the process environment.
const cliDatabaseUrl =
  process.env.DATABASE_URL ??
  'mysql://generate_only:generate_only@127.0.0.1:3306/openbmb_generate_only';

export default defineConfig({
  // Prisma resolves these paths relative to this config file.
  schema: 'schema.prisma',
  migrations: {
    // The executable migration history has one canonical owner.
    path: '../../../apps/server-api/prisma/migrations',
  },
  datasource: {
    url: cliDatabaseUrl,
  },
});
