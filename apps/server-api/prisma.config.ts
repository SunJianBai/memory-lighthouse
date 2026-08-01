import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` only needs a provider-shaped URL, not a live database.
// This non-secret localhost target keeps clean builds deterministic. Runtime
// startup remains strict: PrismaService refuses to start without DATABASE_URL.
const cliDatabaseUrl =
  process.env.DATABASE_URL ??
  'mysql://generate_only:generate_only@127.0.0.1:3306/openbmb_generate_only';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: cliDatabaseUrl,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
