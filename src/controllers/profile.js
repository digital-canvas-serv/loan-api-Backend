import { prisma, TRANSACTION_OPTIONS } from '../config/db.js';
import { z } from 'zod';

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  dateOfBirth: z.string().date().optional().or(z.literal('')),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional().or(z.literal('')),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  postalCode: z.string().trim().max(20).optional().or(z.literal('')),
  occupation: z.string().trim().max(120).optional().or(z.literal('')),
  businessInfo: z.string().trim().max(2000).optional().or(z.literal(''))
});

const profileSelect = { id: true, name: true, email: true, status: true, reviewNote: true, dateOfBirth: true, phone: true, address: true, city: true, state: true, postalCode: true, occupation: true, businessInfo: true, profilePhoto: true, createdAt: true, updatedAt: true };

export async function getProfile(req, res) {
  const profile = await prisma.user.findUnique({ where: { id: req.user.id }, select: { ...profileSelect, documents: { select: { id: true, filename: true, mimeType: true, size: true, status: true, rejectionReason: true, uploadedAt: true, verifiedAt: true, type: { select: { id: true, name: true, required: true } } }, orderBy: { uploadedAt: 'desc' } } } });
  res.json({ profile });
}

export async function updateProfile(req, res) {
  const result = profileSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Please check the profile fields.', errors: result.error.flatten().fieldErrors });
  const data = { ...result.data };
  if (data.dateOfBirth === '') data.dateOfBirth = null;
  else if (data.dateOfBirth) data.dateOfBirth = new Date(`${data.dateOfBirth}T00:00:00.000Z`);
  const profile = await prisma.user.update({ where: { id: req.user.id }, data, select: profileSelect });
  res.json({ profile, message: 'Profile updated.' });
}

export async function listDocumentTypes(req, res) {
  const types = await prisma.documentType.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  res.json({ types });
}

export async function uploadDocuments(req, res) {
  if (!req.files?.length) return res.status(400).json({ message: 'At least one document is required.' });
  const typeId = req.body.documentTypeId || null;
  if (typeId && !await prisma.documentType.findFirst({ where: { id: typeId, active: true } })) return res.status(400).json({ message: 'Invalid document type.' });
  const documents = await prisma.$transaction(req.files.map((file) => prisma.profileDocument.create({ data: { userId: req.user.id, uploadedBy: req.user.id, documentTypeId: typeId, filename: file.originalname, mimeType: file.mimetype, size: file.size, content: file.buffer } })), TRANSACTION_OPTIONS);
  res.status(201).json({ documents: documents.map(({ content, ...document }) => document), message: 'Documents uploaded for review.' });
}

export async function uploadProfilePhoto(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'A profile photo is required.' });
  const type = await prisma.documentType.upsert({ where: { name: 'Profile photo' }, update: { active: true, required: false }, create: { name: 'Profile photo', required: false } });
  const document = await prisma.profileDocument.create({ data: { userId: req.user.id, uploadedBy: req.user.id, documentTypeId: type.id, filename: file.originalname, mimeType: file.mimetype, size: file.size, content: file.buffer } });
  await prisma.user.update({ where: { id: req.user.id }, data: { profilePhoto: document.id } });
  res.status(201).json({ photo: { id: document.id, filename: document.filename }, message: 'Profile photo uploaded for review.' });
}

export async function downloadOwnDocument(req, res) {
  const document = await prisma.profileDocument.findFirst({ where: { id: req.params.documentId, userId: req.user.id } });
  if (!document) return res.status(404).json({ message: 'Document not found.' });
  res.setHeader('Content-Type', document.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${document.filename.replace(/"/g, '')}"`);
  res.send(document.content);
}