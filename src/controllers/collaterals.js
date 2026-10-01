import { prisma } from '../config/db.js';
import { writeAudit } from '../utils/audit.js';
import { createNotification } from '../utils/audit.js';

const serialize = (item) => ({ ...item, value: Number(item.value) });
export async function listCollaterals(req, res) {
  const collaterals = await prisma.collateral.findMany({ where: req.user.role === 'ADMIN' ? {} : { userId: req.user.id }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ collaterals: collaterals.map(serialize) });
}
export async function createCollateral(req, res) {
  const { type, description, value, documentUrl } = req.body;
  if (!type || !description || !value || Number(value) <= 0) return res.status(400).json({ message: 'Type, description, and a positive value are required.' });
  const collateral = await prisma.collateral.create({ data: { userId: req.user.id, type, description, value: Number(value), documentUrl } });
  res.status(201).json({ collateral: serialize(collateral) });
}
export async function updateCollateralStatus(req, res) {
  const { status } = req.body;
  if (!['VERIFIED', 'REJECTED', 'RELEASED'].includes(status)) return res.status(400).json({ message: 'Invalid collateral status.' });
  const collateral = await prisma.collateral.update({ where: { id: req.params.id }, data: { status } });
  await writeAudit({ actorId: req.user.id, action: `COLLATERAL_${status}`, entityType: 'COLLATERAL', entityId: collateral.id });
  if (status === 'VERIFIED') await createNotification({ userId: collateral.userId, type: 'COLLATERAL_VERIFIED', title: 'Collateral verified', message: 'Your collateral has been verified.', entityId: collateral.id });
  res.json({ collateral: serialize(collateral) });
}