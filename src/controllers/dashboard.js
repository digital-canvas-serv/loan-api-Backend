import { prisma } from '../config/db.js';

export async function dashboard(req, res) {
  const [loans, collateralCount, repayments] = await Promise.all([
    prisma.loan.findMany({ where: { userId: req.user.id }, include: { repayments: true }, orderBy: { createdAt: 'desc' } }),
    prisma.collateral.count({ where: { userId: req.user.id } }),
    prisma.repayment.findMany({ where: { userId: req.user.id }, orderBy: { paidAt: 'desc' }, take: 5 })
  ]);
  const borrowed = loans.reduce((total, loan) => total + Number(loan.amount), 0);
  const paid = repayments.reduce((total, item) => total + Number(item.amount), 0);
  res.json({ metrics: { borrowed, paid, outstanding: Math.max(0, borrowed - paid), collateralCount, activeLoans: loans.filter((loan) => ['ACTIVE', 'APPROVED'].includes(loan.status)).length }, recentLoans: loans.slice(0, 5).map((loan) => ({ ...loan, amount: Number(loan.amount) })), recentRepayments: repayments.map((item) => ({ ...item, amount: Number(item.amount) })) });
}