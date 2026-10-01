import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGIN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FILE_STORAGE_PROVIDER: z.enum(['database']).default('database')
});

let envCache = null;

function getEnv() {
  if (!envCache) {
    const values = schema.parse(process.env);
    envCache = { ...values, CORS_ORIGIN: values.CORS_ORIGIN || values.CLIENT_URL };
  }
  return envCache;
}

function requireDatabaseUrl() {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  return env.DATABASE_URL;
}

export const env = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'DATABASE_URL') {
      return requireDatabaseUrl();
    }
    return getEnv()[prop];
  },
});