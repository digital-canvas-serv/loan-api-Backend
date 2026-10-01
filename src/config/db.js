import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * Prisma aborts an interactive transaction after 5 seconds by default. Anything
 * that writes document bytes into PostgreSQL (`bytea` payloads up to 5 MB per
 * file, up to 5 files) regularly exceeds that on a remote host such as Neon and
 * fails with P2028 "Transaction not found". These budgets cover the slowest
 * round trip plus the byte transfer.
 */
export const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 60_000 };
