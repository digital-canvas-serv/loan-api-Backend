import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/db.js';

export async function authenticateUser(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Authentication required.' });
    const payload = jwt.verify(token, env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ message: 'Account not found.' });
    if (user.status !== 'APPROVED' && req.path !== '/auth/me') return res.status(403).json({ code: 'ACCOUNT_NOT_APPROVED', status: user.status, message: accountStatusMessage(user.status, user.reviewNote) });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

export const requireAuth = authenticateUser;

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: 'You do not have permission to perform this action.' });
    next();
  };
}

export const requireAdmin = requireRole('ADMIN', 'SUPER_ADMIN');
export const requireSuperAdmin = requireRole('SUPER_ADMIN');

function accountStatusMessage(status, reviewNote) {
  if (status === 'PENDING') return reviewNote || 'Your profile is awaiting admin review.';
  if (status === 'REJECTED') return reviewNote || 'Your profile was not approved. Contact support for next steps.';
  if (status === 'SUSPENDED') return 'Your account is temporarily suspended. Contact support.';
  if (status === 'BLOCKED') return 'Your account is blocked. Contact support.';
  return 'Your account is not available.';
}