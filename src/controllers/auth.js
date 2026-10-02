import { prisma, TRANSACTION_OPTIONS } from '../config/db.js';
import { comparePassword, hashPassword, publicUser, signToken } from '../utils/auth.js';
import { createNotification, writeAudit } from '../utils/audit.js';

export async function register(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: 'Name, email, and an 8-character password are required.' });
  if (!req.files?.length) return res.status(400).json({ message: 'At least one identity or ownership document is required.' });
  const normalizedEmail = email.toLowerCase().trim();
  if (await prisma.user.findUnique({ where: { email: normalizedEmail } })) return res.status(409).json({ message: 'An account with that email already exists.' });
  const user = await prisma.$transaction(async (transaction) => {
    const createdUser = await transaction.user.create({ data: { name: name.trim(), email: normalizedEmail, passwordHash: await hashPassword(password) } });
    await Promise.all(req.files.map((file) => transaction.profileDocument.create({ data: { userId: createdUser.id, uploadedBy: createdUser.id, filename: file.originalname, mimeType: file.mimetype, size: file.size, content: file.buffer } })));
    return createdUser;
  }, TRANSACTION_OPTIONS);
  await createNotification({ userId: user.id, type: 'PROFILE_SUBMITTED', title: 'Profile submitted', message: 'Your profile is awaiting administrator review.' });
  res.status(201).json({ user: publicUser(user), message: 'Profile submitted. An administrator must approve your account before you can sign in.' });
}

export async function login(req, res) {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase().trim() } });
  if (!user || !(await comparePassword(password || '', user.passwordHash))) return res.status(401).json({ message: 'Email or password is incorrect.' });
  if (user.status !== 'APPROVED') return res.status(403).json({ code: 'ACCOUNT_NOT_APPROVED', status: user.status, message: statusMessage(user.status, user.reviewNote) });
  await writeAudit({ actorId: user.id, action: 'LOGIN', entityType: 'USER', entityId: user.id, req });
  res.json({ token: signToken(user), user: publicUser(user) });
}

export async function adminLogin(req, res) {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase().trim() } });
  if (!user || !(await comparePassword(password || '', user.passwordHash))) return res.status(401).json({ message: 'Email or password is incorrect.' });
  if (user.status !== 'APPROVED') return res.status(403).json({ code: 'ACCOUNT_NOT_APPROVED', status: user.status, message: statusMessage(user.status, user.reviewNote) });
  // Validate admin role
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    await writeAudit({ actorId: user.id, action: 'ADMIN_LOGIN_FAILED', entityType: 'USER', entityId: user.id, req, meta: { reason: 'NOT_ADMIN', role: user.role } });
    return res.status(403).json({ message: 'Admin access required. This account does not have administrator privileges.' });
  }
  await writeAudit({ actorId: user.id, action: 'ADMIN_LOGIN', entityType: 'USER', entityId: user.id, req });
  res.json({ token: signToken(user), user: publicUser(user) });
}

export async function logout(req, res) {
  await writeAudit({ actorId: req.user.id, action: 'LOGOUT', entityType: 'USER', entityId: req.user.id, req });
  res.json({ message: 'Signed out.' });
}

export function me(req, res) { res.json({ user: publicUser(req.user) }); }

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8) return res.status(400).json({ message: 'Current password and a new 8-character password are required.' });
  if (!(await comparePassword(currentPassword, req.user.passwordHash))) return res.status(401).json({ message: 'Current password is incorrect.' });
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await hashPassword(newPassword) } });
  res.json({ message: 'Password changed. Please sign in again.' });
}

function statusMessage(status, reviewNote) {
  if (status === 'PENDING') return reviewNote || 'Your profile is awaiting admin review.';
  if (status === 'REJECTED') return reviewNote || 'Your profile was not approved. Contact support for next steps.';
  if (status === 'SUSPENDED') return 'Your account is temporarily suspended. Contact support.';
  return 'Your account is blocked. Contact support.';
}