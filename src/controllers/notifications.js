import { prisma } from '../config/db.js';

export async function listNotifications(req, res) {
  const notifications = await prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ notifications });
}

export async function markNotificationRead(req, res) {
  const notification = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user.id }, data: { readAt: new Date() } });
  if (!notification.count) return res.status(404).json({ message: 'Notification not found.' });
  res.json({ message: 'Notification marked as read.' });
}
