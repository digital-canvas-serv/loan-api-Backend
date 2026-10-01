import { z } from 'zod';
import { prisma, TRANSACTION_OPTIONS } from '../config/db.js';
import { writeAudit } from '../utils/audit.js';
import { createNotification } from '../utils/audit.js';
import { generateRepaymentSchedule } from './repayments.js';

const applicationSchema = z.object({
  loanProductId: z.string().min(1),
  requestedAmount: z.coerce.number().positive().max(100000000),
  requestedTenureMonths: z.coerce.number().int().positive().max(360),
  purpose: z.string().trim().min(5).max(1000),
  repaymentPreference: z.enum(['MONTHLY', 'BIWEEKLY', 'QUARTERLY', 'BULLET']),
  collateralType: z.enum(['Gold/Jewellery', 'Electronics', 'Vehicle', 'Other eligible assets']),
  itemName: z.string().trim().min(2).max(160),
  collateralDescription: z.string().trim().min(5).max(2000),
  quantity: z.coerce.number().positive().max(100000),
  weight: z.coerce.number().nonnegative().max(100000).optional().or(z.literal('')),
  declaredValue: z.coerce.number().positive().max(100000000),
  ownershipInformation: z.string().trim().min(5).max(2000)
});

const loanInclude = { collateral: true, product: true, repayments: { orderBy: { paidAt: 'desc' } }, documents: { select: { id: true, filename: true, mimeType: true, status: true, uploadedAt: true } } };
const serialize = (item) => item && { ...item, amount: Number(item.amount), requestedAmount: item.requestedAmount == null ? null : Number(item.requestedAmount), approvedAmount: item.approvedAmount == null ? null : Number(item.approvedAmount), interestRate: Number(item.interestRate), collateral: item.collateral && { ...item.collateral, value: Number(item.collateral.value), declaredValue: item.collateral.declaredValue == null ? null : Number(item.collateral.declaredValue), quantity: item.collateral.quantity == null ? null : Number(item.collateral.quantity), weight: item.collateral.weight == null ? null : Number(item.collateral.weight) }, product: item.product && { ...item.product, minAmount: Number(item.product.minAmount), maxAmount: Number(item.product.maxAmount), baseRate: Number(item.product.baseRate) }, repayments: item.repayments?.map((repayment) => ({ ...repayment, amount: Number(repayment.amount) })) };

export async function listProducts(req, res) {
  const products = await prisma.loanProduct.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  res.json({ products: products.map((product) => ({ ...product, minAmount: Number(product.minAmount), maxAmount: Number(product.maxAmount), baseRate: Number(product.baseRate) })) });
}

export async function listLoans(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20)); const status = String(req.query.status || ''); const search = String(req.query.search || '').trim();
  const where = { ...(['ADMIN', 'SUPER_ADMIN'].includes(req.user.role) ? {} : { userId: req.user.id }), ...(status ? { status } : {}), ...(search ? { OR: [{ purpose: { contains: search, mode: 'insensitive' } }, { user: { name: { contains: search, mode: 'insensitive' } } }] } : {}) };
  const [loans, total] = await Promise.all([prisma.loan.findMany({ where, include: { ...loanInclude, user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), prisma.loan.count({ where })]);
  res.json({ loans: loans.map(serialize), pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
}

export async function createLoan(req, res) {
  const result = applicationSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Please complete all loan and collateral fields.', errors: result.error.flatten().fieldErrors });
  if (!req.files?.length) return res.status(400).json({ message: 'At least one collateral photo or supporting document is required.' });
  const data = result.data;
  const product = await prisma.loanProduct.findFirst({ where: { id: data.loanProductId, active: true } });
  if (!product) return res.status(400).json({ message: 'The selected loan product is unavailable.' });
  if (data.requestedAmount < Number(product.minAmount) || data.requestedAmount > Number(product.maxAmount) || data.requestedTenureMonths < product.minTermMonths || data.requestedTenureMonths > product.maxTermMonths) return res.status(400).json({ message: 'The requested amount or tenure falls outside this product\'s configured range.' });
  const created = await prisma.$transaction(async (transaction) => {
    const collateral = await transaction.collateral.create({ data: { userId: req.user.id, type: data.collateralType, itemName: data.itemName, description: data.collateralDescription, quantity: data.quantity, weight: data.weight === '' ? null : data.weight, value: data.declaredValue, declaredValue: data.declaredValue, ownershipInformation: data.ownershipInformation, status: 'PENDING' } });
    const loan = await transaction.loan.create({ data: { userId: req.user.id, collateralId: collateral.id, loanProductId: product.id, amount: data.requestedAmount, requestedAmount: data.requestedAmount, interestRate: 0, termMonths: data.requestedTenureMonths, requestedTenureMonths: data.requestedTenureMonths, repaymentPreference: data.repaymentPreference, status: 'SUBMITTED', purpose: data.purpose }, include: loanInclude });
    await Promise.all(req.files.map((file) => transaction.profileDocument.create({ data: { userId: req.user.id, uploadedBy: req.user.id, collateralId: collateral.id, loanId: loan.id, filename: file.originalname, mimeType: file.mimetype, size: file.size, content: file.buffer, status: 'PENDING' } })));
    return loan;
  }, TRANSACTION_OPTIONS);
  res.status(201).json({ loan: serialize(created), message: 'Loan application submitted for review.' });
  await createNotification({ userId: req.user.id, type: 'LOAN_SUBMITTED', title: 'Loan submitted', message: 'Your loan application has been submitted for review.' });
}

export async function getLoan(req, res) {
  const loan = await prisma.loan.findFirst({ where: { id: req.params.id, ...(['ADMIN', 'SUPER_ADMIN'].includes(req.user.role) ? {} : { userId: req.user.id }) }, include: { ...loanInclude, user: { select: { id: true, name: true, email: true } } } });
  if (!loan) return res.status(404).json({ message: 'Loan not found.' });
  res.json({ loan: serialize(loan) });
}

export async function updateLoanStatus(req, res) {
  const { status, approvedAmount, approvedTenureMonths, interestRate, reviewNote } = req.body;
  const allowed = ['UNDER_REVIEW', 'DOCUMENTS_REQUIRED', 'COLLATERAL_VERIFICATION', 'APPROVED', 'REJECTED', 'DISBURSED', 'ACTIVE', 'OVERDUE', 'CLOSED', 'CANCELLED'];
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid loan status.' });
  const existing = await prisma.loan.findUnique({ where: { id: req.params.id }, include: { product: true } });
  if (!existing) return res.status(404).json({ message: 'Loan not found.' });
  const data = { status, reviewNote: reviewNote?.trim() || null };
  if (status === 'APPROVED') {
    const principal = Number(approvedAmount);
    const tenure = Number(approvedTenureMonths);
    const rate = Number(interestRate);
    if (!Number.isFinite(principal) || principal <= 0 || !Number.isInteger(tenure) || tenure <= 0 || !Number.isFinite(rate) || rate < 0) return res.status(400).json({ message: 'Approved amount, tenure, and interest rate are required.' });
    if (principal > Number(existing.requestedAmount || existing.amount)) return res.status(400).json({ message: 'Approved amount cannot exceed the requested amount.' });
    const monthlyRate = rate / 100 / 12;
    const monthlyPayment = monthlyRate === 0 ? principal / tenure : principal * monthlyRate * ((1 + monthlyRate) ** tenure) / (((1 + monthlyRate) ** tenure) - 1);
    data.approvedAmount = principal;
    data.amount = principal;
    data.approvedTenureMonths = tenure;
    data.termMonths = tenure;
    data.interestRate = rate;
    data.monthlyPayment = Number(monthlyPayment.toFixed(2));
    data.feesAmount = Number((principal * Number(existing.product?.originationFeeRate || 0) / 100).toFixed(2));
    data.principalAmount = principal;
    data.totalPayable = Number((monthlyPayment * tenure + Number(data.feesAmount)).toFixed(2));
    data.startDate = new Date();
    data.approvedAt = new Date();
  }
  if (status === 'DISBURSED') data.disbursedAt = new Date();
  if (status === 'CLOSED') data.closedAt = new Date();
  const loan = await prisma.loan.update({ where: { id: req.params.id }, data, include: { ...loanInclude, user: { select: { id: true, name: true, email: true } } } });
  if (status === 'APPROVED') await generateRepaymentSchedule(loan.id);
  await writeAudit({ actorId: req.user.id, action: `LOAN_${status}`, entityType: 'LOAN', entityId: loan.id, metadata: { approvedAmount: data.approvedAmount, approvedTenureMonths: data.approvedTenureMonths, interestRate: data.interestRate, reviewNote: data.reviewNote } });
  await createNotification({ userId: loan.userId, type: status === 'APPROVED' ? 'LOAN_APPROVED' : status === 'REJECTED' ? 'LOAN_REJECTED' : `LOAN_${status}`, title: `Loan ${status.toLowerCase()}`, message: reviewNote || `Your loan application is now ${status.toLowerCase()}.` });
  res.json({ loan: serialize(loan) });
}
