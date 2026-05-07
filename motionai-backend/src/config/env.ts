/**
 * Environment variable validation using Zod.
 * Imported once at startup — fails fast if any required variable is missing.
 */

import { z } from 'zod';

const envSchema = z.object({
  /** TCP port the Express server listens on */
  PORT: z
    .string()
    .default('3000')
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(65535)),

  /** Redis connection URL used by BullMQ */
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),

  /** AWS IAM credentials */
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS_ACCESS_KEY_ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS_SECRET_ACCESS_KEY is required'),

  /** S3 bucket name for storing rendered MP4 files */
  AWS_S3_BUCKET: z.string().min(1, 'AWS_S3_BUCKET is required'),

  /** AWS region where the S3 bucket lives */
  AWS_REGION: z.string().min(1, 'AWS_REGION is required'),

  /** Google Gemini API key */
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),

  /** Supabase project URL */
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),

  /** Supabase anon/public key */
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),

  /** Supabase service role key used for backend-owned database access */
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  /** Maximum number of render jobs to process concurrently */
  MAX_RENDER_CONCURRENT: z
    .string()
    .default('2')
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(16)),

  /** Node runtime environment */
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  /** Local directory used as scratch space during rendering */
  TEMP_DIR: z.string().default('/tmp/motionai'),
});

/** Parsed and type-safe environment configuration */
export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`❌ Invalid environment variables:\n${formatted}`);
  }

  return result.data;
}

export const env: Env = parseEnv();
