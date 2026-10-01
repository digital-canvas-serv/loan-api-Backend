import { prisma } from '../config/db.js';

export function writeAudit({ actorId, action, entityType, entityId, metadata, previousValue, newValue, req }) {
  return prisma.auditLog.create({ data: { actorId, action, entityType, entityId, metadata, previousValue, newValue, ipAddress: req?.ip, userAgent: req?.get('user-agent') } });
}

export async function createNotification({ userId, type, title, message, entityId }) {
  if (entityId) {
    const existing = await prisma.notification.findFirst({ where: { userId, type, entityId } });
    if (existing) return existing;
  }
  return prisma.notification.create({ data: { userId, type, title, message, entityId } });
}
