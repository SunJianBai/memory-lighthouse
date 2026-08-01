import { z } from 'zod';

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.enum(['127.0.0.1', '0.0.0.0', '::1', '::']).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    CORS_ORIGINS: z
      .string()
      .default('http://127.0.0.1:4310,http://localhost:4310')
      .refine(
        (value) =>
          value
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean).length > 0,
        'CORS_ORIGINS must contain at least one origin',
      )
      .refine(
        (value) => !value.split(',').some((origin) => origin.trim() === '*'),
        'CORS_ORIGINS cannot contain * when credentials are enabled',
      )
      .refine(
        (value) =>
          value
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
            .every(isHttpOrigin),
        'CORS_ORIGINS must contain only HTTP(S) origins',
      ),
  })
  .passthrough();

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment & Record<string, unknown> {
  const result = environmentSchema.safeParse(values);

  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  }

  return result.data;
}
