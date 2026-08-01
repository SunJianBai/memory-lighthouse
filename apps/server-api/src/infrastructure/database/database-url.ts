const DATABASE_PROTOCOL = 'mysql:';

export const DATABASE_URL_ENV_NAME = 'DATABASE_URL';

/**
 * Returns the opaque connection URL after checking only the shape required by
 * Prisma's MySQL connector. Error messages deliberately never echo the URL.
 */
export function requireDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = environment[DATABASE_URL_ENV_NAME]?.trim();

  if (!databaseUrl) {
    throw new Error(`${DATABASE_URL_ENV_NAME} is required`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(`${DATABASE_URL_ENV_NAME} must be a valid MySQL URL`);
  }

  if (parsedUrl.protocol !== DATABASE_PROTOCOL) {
    throw new Error(`${DATABASE_URL_ENV_NAME} must use the mysql protocol`);
  }

  if (!parsedUrl.hostname) {
    throw new Error(`${DATABASE_URL_ENV_NAME} must include a host`);
  }

  if (parsedUrl.pathname.length <= 1) {
    throw new Error(`${DATABASE_URL_ENV_NAME} must include a database name`);
  }

  return databaseUrl;
}
