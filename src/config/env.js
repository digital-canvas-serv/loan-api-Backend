import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGIN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FILE_STORAGE_PROVIDER: z.enum(['database']).default('database')
});

const values = schema.parse(process.env);
export const env = { ...values, CORS_ORIGIN: values.CORS_ORIGIN || values.CLIENT_URL };