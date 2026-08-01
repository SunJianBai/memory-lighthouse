import { defineConfig, env } from "prisma/config";

// The real server bootstrap may import `dotenv/config` for local development.
// CI and production inject DATABASE_URL directly into the process environment.

export default defineConfig({
  schema: "docs/refactor/database/schema.prisma",
  migrations: {
    path: "docs/refactor/database/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
