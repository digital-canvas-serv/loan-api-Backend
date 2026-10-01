import { z } from 'zod';
import { prisma, TRANSACTION_OPTIONS } from '../config/db.js';
import { writeAudit } from '../utils/audit.js';
import { createNotification } from '../utils/audit.js';

const paymentSchema = z.object({ loanId: z.string().min(1), amount: z.coerce.number().positive().max(100000000), method: z.enum(['BANK_TRANSFER', 'CARD', 'CASH', 'WALLET', 'OTHER']), referenceId: z.string().trim().max(160).optional(), scheduleId: z.string().optional() });
const paymentInclude = { loan: { select: { id: true, amount: true, purpose: true, approvedAmount: true, status: true } }, schedule: true, recorder: { select: { name: true, email: true } } };
const serializePayment = (item) => ({ ...item, amount: Number(item.amount), loan: item.loan && { ...item.loan, amount: Number(item.loan.amount), approvedAmount: item.loan.approvedAmount == null ? null : Number(item.loan.approvedAmount) }, schedule: item.schedule && { ...item.schedule, principalDue: Number(item.schedule.principalDue), interestDue: Number(item.schedule.interestDue), feesDue: Number(item.schedule.feesDue), totalDue: Number(item.schedule.totalDue), principalPaid: Number(item.schedule.principalPaid), interestPaid: Number(item.schedule.interestPaid), feesPaid: Number(item.schedule.feesPaid) } });

async function calculateLoanBalance(loanId) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId }, include: { payments: { where: { status: 'SUCCESS' } }, schedules: { orderBy: { installmentNo: 'asc' } } } });
  if (!loan) return null;
  const totalDue = loan.schedules.reduce((sum, row) => sum + Number(row.totalDue), 0) || Number(loan.totalPayable || loan.amount);
  const paid = loan.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const outstanding = Math.max(0, totalDue - paid);
  const nextPayment = loan.schedules.find((row) => Number(row.totalDue) > Number(row.principalPaid) + Number(row.interestPaid) + Number(row.feesPaid));
  return { totalDue, paid, outstanding, nextPayment: nextPayment ? { ...nextPayment, totalDue: Number(nextPayment.totalDue), dueDate: nextPayment.dueDate } : null };
}

export async function generateRepaymentSchedule(loanId) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId }, include: { product: true } });
  if (!loan || !loan.approvedAmount || !loan.approvedTenureMonths || !loan.startDate) return;
  await prisma.repaymentSchedule.deleteMany({ where: { loanId } });
  const principal = Number(loan.approvedAmount); const months = loan.approvedTenureMonths; const annualRate = Number(loan.interestRate); const monthlyRate = annualRate / 100 / 12; const fee = Number(loan.feesAmount || 0); const payment = Number(loan.monthlyPayment || principal / months); const rows = []; let remainingPrincipal = principal;
  for (let index = 1; index <= months; index += 1) {
    const interest = monthlyRate === 0 ? 0 : remainingPrincipal * monthlyRate;
    const principalDue = index === months ? remainingPrincipal : Math.max(0, payment - interest);
    rows.push({ loanId, installmentNo: index, dueDate: new Date(new Date(loan.startDate).setMonth(new Date(loan.startDate).getMonth() + index)), principalDue: Number(principalDue.toFixed(2)), interestDue: Number(interest.toFixed(2)), feesDue: index === 1 ? fee : 0, totalDue: Number((principalDue + interest + (index === 1 ? fee : 0)).toFixed(2)) });
    remainingPrincipal = Math.max(0, remainingPrincipal - principalDue);
  }
  await prisma.repaymentSchedule.createMany({ data: rows });
}

export async function listRepayments(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const where = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role) ? {} : { userId: req.user.id };
  const [payments, total] = await Promise.all([prisma.payment.findMany({ where, include: paymentInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), prisma.payment.count({ where })]);
  res.json({ payments: payments.map(serializePayment), pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
}

export async function getLoanRepaymentSummary(req, res) {
  const loan = await prisma.loan.findFirst({ where: { id: req.params.loanId, ...(['ADMIN', 'SUPER_ADMIN'].includes(req.user.role) ? {} : { userId: req.user.id }) }, include: { schedules: { orderBy: { installmentNo: 'asc' } }, payments: { include: paymentInclude, orderBy: { createdAt: 'desc' } } } });
  if (!loan) return res.status(404).json({ message: 'Loan not found.' });
  const balance = await calculateLoanBalance(loan.id);
  if (balance.nextPayment) {
    const dueDate = new Date(balance.nextPayment.dueDate); const daysUntilDue = (dueDate.getTime() - Date.now()) / 86400000;
    if (daysUntilDue < 0) await createNotification({ userId: loan.userId, type: 'PAYMENT_OVERDUE', title: 'Payment overdue', message: `Installment ${balance.nextPayment.installmentNo} is overdue.`, entityId: balance.nextPayment.id });
    else if (daysUntilDue <= 7) await createNotification({ userId: loan.userId, type: 'PAYMENT_DUE', title: 'Payment due soon', message: `Your next payment is due ${dueDate.toLocaleDateString()}.`, entityId: balance.nextPayment.id });
  }
  res.json({ summary: balance, schedule: loan.schedules.map((row) => ({ ...row, principalDue: Number(row.principalDue), interestDue: Number(row.interestDue), feesDue: Number(row.feesDue), totalDue: Number(row.totalDue), principalPaid: Number(row.principalPaid), interestPaid: Number(row.interestPaid), feesPaid: Number(row.feesPaid) })), payments: loan.payments.map(serializePayment) });
}

export async function createPayment(req, res) {
  const result = paymentSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Loan, amount, payment method, and valid payment details are required.' });
  const data = result.data;
  const loan = await prisma.loan.findFirst({ where: { id: data.loanId, userId: req.user.id, status: { in: ['ACTIVE', 'DISBURSED', 'APPROVED'] } } });
  if (!loan) return res.status(404).json({ message: 'An eligible loan was not found.' });
  const balance = await calculateLoanBalance(loan.id);
  if (!balance || data.amount > balance.outstanding) return res.status(400).json({ message: 'Payment exceeds the current outstanding balance.' });
  const payment = await prisma.payment.create({ data: { loanId: loan.id, userId: req.user.id, scheduleId: data.scheduleId, amount: data.amount, method: data.method, referenceId: data.referenceId, status: 'PENDING', recordedBy: req.user.id }, include: paymentInclude });
  await writeAudit({ actorId: req.user.id, action: 'PAYMENT_CREATED', entityType: 'PAYMENT', entityId: payment.id, metadata: { loanId: loan.id, amount: data.amount } });
  await createNotification({ userId: req.user.id, type: 'PAYMENT_RECORDED', title: 'Payment submitted', message: 'Your payment is pending reconciliation.' });
  res.status(201).json({ payment: serializePayment(payment), message: 'Payment submitted for reconciliation.' });
}

export async function reconcilePayment(req, res) {
  const { status, referenceId } = req.body;
  if (!['SUCCESS', 'FAILED', 'REVERSED', 'REFUNDED'].includes(status)) return res.status(400).json({ message: 'Invalid payment reconciliation status.' });
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ message: 'Payment not found.' });
  if (payment.status !== 'PENDING') return res.status(409).json({ message: 'Only pending payments can be reconciled.' });
  const updated = await prisma.$transaction(async (transaction) => {
    const changed = await transaction.payment.update({ where: { id: payment.id }, data: { status, referenceId: referenceId?.trim() || payment.referenceId }, include: paymentInclude });
    if (status === 'SUCCESS' && payment.scheduleId) {
      const schedule = await transaction.repaymentSchedule.findUnique({ where: { id: payment.scheduleId } });
      if (schedule) await transaction.repaymentSchedule.update({ where: { id: schedule.id }, data: { principalPaid: { increment: payment.amount } } });
    }
    return changed;
  }, TRANSACTION_OPTIONS);
  await writeAudit({ actorId: req.user.id, action: `PAYMENT_${status}`, entityType: 'PAYMENT', entityId: updated.id, metadata: { loanId: updated.loanId, amount: Number(updated.amount) } });
  await createNotification({ userId: updated.userId, type: 'PAYMENT_RECORDED', title: `Payment ${status.toLowerCase()}`, message: `Your payment has been marked ${status.toLowerCase()}.` });
  res.json({ payment: serializePayment(updated) });
}

export async function paymentReport(req, res) {
  const where = { ...(req.query.status ? { status: req.query.status } : {}), ...(req.query.from || req.query.to ? { paymentDate: { ...(req.query.from ? { gte: new Date(req.query.from) } : {}), ...(req.query.to ? { lte: new Date(req.query.to) } : {}) } } : {}) };
  const payments = await prisma.payment.findMany({ where, orderBy: { paymentDate: 'desc' }, include: { loan: { select: { id: true, purpose: true } }, user: { select: { name: true, email: true } } } });
  const successfulTotal = payments.filter((payment) => payment.status === 'SUCCESS').reduce((sum, payment) => sum + Number(payment.amount), 0);
  res.json({ summary: { count: payments.length, successfulTotal }, payments: payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })) });
}

export async function paymentReceipt(req, res) {
  const payment = await prisma.payment.findFirst({ where: { id: req.params.id, ...(['ADMIN', 'SUPER_ADMIN'].includes(req.user.role) ? {} : { userId: req.user.id }) }, include: { loan: { select: { id: true, purpose: true } }, user: { select: { name: true, email: true } } } });
  if (!payment) return res.status(404).json({ message: 'Payment not found.' });
  res.json({ receipt: { paymentId: payment.id, loanId: payment.loanId, loanPurpose: payment.loan.purpose, user: payment.user, amount: Number(payment.amount), paymentDate: payment.paymentDate, method: payment.method, referenceId: payment.referenceId, status: payment.status, createdAt: payment.createdAt } });
}

export { calculateLoanBalance };
