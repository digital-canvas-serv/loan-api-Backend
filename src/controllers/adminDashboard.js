import { prisma } from '../config/db.js';

export async function adminDashboard(req, res) {
  const [totalUsers, pendingUsers, approvedUsers, totalLoanApplications, pendingApplications, activeLoans, closedLoans, overdueLoans, pendingKyc, pendingCollateral] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'PENDING' } }),
    prisma.user.count({ where: { status: 'APPROVED' } }),
    prisma.loan.count(),
    prisma.loan.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'DOCUMENTS_REQUIRED', 'COLLATERAL_VERIFICATION', 'PENDING'] } } }),
    prisma.loan.count({ where: { status: { in: ['ACTIVE', 'DISBURSED'] } } }),
    prisma.loan.count({ where: { status: { in: ['CLOSED', 'PAID'] } } }),
    prisma.loan.count({ where: { status: { in: ['OVERDUE', 'DEFAULTED'] } } }),
    prisma.profileDocument.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW', 'REQUIRES_UPDATE'] } } }),
    prisma.collateral.count({ where: { status: 'PENDING' } })
  ]);
  res.json({ metrics: { totalUsers, pendingUsers, approvedUsers, totalLoanApplications, pendingApplications, activeLoans, closedLoans, overdueLoans, pendingKyc, pendingCollateral } });
}

export async function listAuditLogs(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
  const [logs, total] = await Promise.all([prisma.auditLog.findMany({ include: { actor: { select: { name: true, email: true, role: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), prisma.auditLog.count()]);
  res.json({ logs, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
}

export async function report(req, res) {
  const type = String(req.query.type || 'users'); const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25)); const search = String(req.query.search || '').trim(); const from = req.query.from ? new Date(req.query.from) : undefined; const to = req.query.to ? new Date(req.query.to) : undefined; const date = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
  let rows; let total;
  if (type === 'users' || type === 'kyc') { const where = { ...(type === 'kyc' ? { documents: { some: {} } } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}), ...(date ? { createdAt: date } : {}) }; [rows, total] = await Promise.all([prisma.user.findMany({ where, select: { id: true, name: true, email: true, status: true, createdAt: true, _count: { select: { documents: true } } }, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }), prisma.user.count({ where })]); }
  else if (type === 'payments') { const where = { ...(search ? { referenceId: { contains: search, mode: 'insensitive' } } : {}), ...(date ? { paymentDate: date } : {}) }; [rows, total] = await Promise.all([prisma.payment.findMany({ where, include: { user: { select: { name: true, email: true } }, loan: { select: { purpose: true } } }, skip: (page - 1) * pageSize, take: pageSize, orderBy: { paymentDate: 'desc' } }), prisma.payment.count({ where })]); }
  else { const where = { ...(req.query.status ? { status: req.query.status } : {}), ...(search ? { OR: [{ purpose: { contains: search, mode: 'insensitive' } }, { user: { name: { contains: search, mode: 'insensitive' } } }] } : {}), ...(date ? { createdAt: date } : {}) }; [rows, total] = await Promise.all([prisma.loan.findMany({ where, include: { user: { select: { name: true, email: true } }, collateral: { select: { type: true, itemName: true, status: true } } }, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }), prisma.loan.count({ where })]); }
  if (type === 'outstanding') {
    const loans = await prisma.loan.findMany({ where: { status: { in: ['APPROVED', 'DISBURSED', 'ACTIVE', 'OVERDUE'] } }, include: { user: { select: { name: true, email: true } }, payments: { where: { status: 'SUCCESS' } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize });
    rows = loans.map((loan) => ({ id: loan.id, name: loan.user.name, email: loan.user.email, purpose: loan.purpose, status: loan.status, outstanding: Number(loan.totalPayable || loan.amount) - loan.payments.reduce((sum, payment) => sum + Number(payment.amount), 0), createdAt: loan.createdAt }));
    total = await prisma.loan.count({ where: { status: { in: ['APPROVED', 'DISBURSED', 'ACTIVE', 'OVERDUE'] } } });
  }
  const output = rows.map((row) => { const value = { ...row }; if (value.amount != null) value.amount = Number(value.amount); if (value.approvedAmount != null) value.approvedAmount = Number(value.approvedAmount); if (value.totalPayable != null) value.totalPayable = Number(value.totalPayable); if (value.createdAt) value.createdAt = value.createdAt.toISOString(); if (value.paymentDate) value.paymentDate = value.paymentDate.toISOString(); return value; });
  if (req.query.format === 'csv') { const columns = output.length ? Object.keys(output[0]) : ['id']; const csv = [columns.join(','), ...output.map((row) => columns.map((column) => JSON.stringify(row[column] ?? '')).join(','))].join('\n'); res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`); return res.send(csv); }
  res.json({ type, rows: output, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
}
