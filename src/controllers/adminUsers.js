import { prisma } from '../config/db.js';
import { hashPassword, publicUser } from '../utils/auth.js';
import { writeAudit } from '../utils/audit.js';
import { createNotification } from '../utils/audit.js';
import { downloadFromBlob, isBlobConfigured } from '../services/storage.js';

export async function listUsers(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20)); const search = String(req.query.search || '').trim(); const status = String(req.query.status || '');
  const where = { ...(status ? { status } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}) };
  const [users, total] = await Promise.all([prisma.user.findMany({ where, select: { id: true, name: true, email: true, role: true, status: true, reviewNote: true, dateOfBirth: true, phone: true, address: true, city: true, state: true, postalCode: true, occupation: true, businessInfo: true, profilePhoto: true, createdAt: true, _count: { select: { documents: true, loans: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), prisma.user.count({ where })]);
  res.json({ users, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
}

export async function reviewUser(req, res) {
  const { status, reviewNote } = req.body;
  if (!['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED'].includes(status)) return res.status(400).json({ message: 'Invalid account status.' });
  if (status === 'BLOCKED' && req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Only a super administrator can block accounts.' });
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { status, reviewNote: reviewNote || null } });
  await writeAudit({ actorId: req.user.id, action: `USER_${status}`, entityType: 'USER', entityId: user.id, metadata: { reviewNote: reviewNote || null } });
  await createNotification({ userId: user.id, type: status === 'APPROVED' ? 'PROFILE_APPROVED' : status === 'REJECTED' ? 'PROFILE_REJECTED' : 'ADDITIONAL_INFORMATION_REQUESTED', title: status === 'APPROVED' ? 'Profile approved' : status === 'REJECTED' ? 'Profile review updated' : 'Profile status updated', message: reviewNote || `Your profile status is now ${status.toLowerCase()}.` });
  res.json({ user: publicUser(user), message: status === 'APPROVED' ? 'Account approved and credentials activated.' : 'Account review updated.' });
}

export async function setCredentials(req, res) {
  const { password } = req.body;
  if (req.user.role !== 'SUPER_ADMIN' && req.user.id === req.params.id) return res.status(403).json({ message: 'Use the password change endpoint for your own account.' });
  if (!password || password.length < 8) return res.status(400).json({ message: 'A new password of at least 8 characters is required.' });
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash: await hashPassword(password), status: 'APPROVED', reviewNote: null } });
  await writeAudit({ actorId: req.user.id, action: 'USER_CREDENTIALS_ACTIVATED', entityType: 'USER', entityId: user.id });
  res.json({ user: publicUser(user), message: 'Credentials activated.' });
}

export async function listDocuments(req, res) {
  const documents = await prisma.profileDocument.findMany({ where: { userId: req.params.id }, select: { id: true, filename: true, mimeType: true, size: true, status: true, rejectionReason: true, uploadedBy: true, uploadedAt: true, verifiedBy: true, verifiedAt: true, type: { select: { id: true, name: true, required: true } } }, orderBy: { uploadedAt: 'desc' } });
  res.json({ documents });
}

export async function downloadDocument(req, res) {
  const document = await prisma.profileDocument.findFirst({ where: { id: req.params.documentId, userId: req.params.id } });
  if (!document) return res.status(404).json({ message: 'Document not found.' });

  if (isBlobConfigured() && document.blobPathname) {
    try {
      const blob = await downloadFromBlob(document.blobPathname);
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${document.filename.replace(/"/g, '')}"`);
      return blob.stream().pipe(res);
    } catch (error) {
      console.error('Blob download error:', error);
      return res.status(500).json({ message: 'Failed to download document from storage.' });
    }
  }

  return res.status(404).json({ message: 'Document content not available in storage.' });
}

export async function reviewDocument(req, res) {
  const { status, rejectionReason } = req.body;
  if (!['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'REQUIRES_UPDATE'].includes(status)) return res.status(400).json({ message: 'Invalid document status.' });
  if (['REJECTED', 'REQUIRES_UPDATE'].includes(status) && (!rejectionReason || rejectionReason.trim().length < 5)) return res.status(400).json({ message: 'A rejection or replacement reason is required.' });
  const document = await prisma.profileDocument.findFirst({ where: { id: req.params.documentId, userId: req.params.id } });
  if (!document) return res.status(404).json({ message: 'Document not found.' });
  const updated = await prisma.profileDocument.update({ where: { id: document.id }, data: { status, rejectionReason: ['REJECTED', 'REQUIRES_UPDATE'].includes(status) ? rejectionReason.trim() : null, verifiedBy: ['VERIFIED', 'REJECTED'].includes(status) ? req.user.id : null, verifiedAt: ['VERIFIED', 'REJECTED'].includes(status) ? new Date() : null } });
  await writeAudit({ actorId: req.user.id, action: `DOCUMENT_${status}`, entityType: 'DOCUMENT', entityId: updated.id, metadata: { userId: req.params.id, rejectionReason: rejectionReason || null } });
  res.json({ document: updated, message: 'Document review updated.' });
}

export async function listDocumentTypes(req, res) {
  const types = await prisma.documentType.findMany({ orderBy: { name: 'asc' } });
  res.json({ types });
}

export async function createDocumentType(req, res) {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2 || name.length > 80) return res.status(400).json({ message: 'Document type name must be 2 to 80 characters.' });
  const type = await prisma.documentType.create({ data: { name, description: req.body.description?.trim(), required: req.body.required !== false } });
  res.status(201).json({ type });
}

export async function updateDocumentType(req, res) {
  const data = {};
  if (typeof req.body.name === 'string') data.name = req.body.name.trim();
  if (typeof req.body.description === 'string') data.description = req.body.description.trim();
  if (typeof req.body.required === 'boolean') data.required = req.body.required;
  if (typeof req.body.active === 'boolean') data.active = req.body.active;
  const type = await prisma.documentType.update({ where: { id: req.params.typeId }, data });
  res.json({ type });
}