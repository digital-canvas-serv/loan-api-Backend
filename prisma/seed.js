import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;

if (!email || !password || password.length < 12) throw new Error('SUPER_ADMIN_EMAIL and a SUPER_ADMIN_PASSWORD of at least 12 characters are required.');
const passwordHash = await bcrypt.hash(password, 12);
await prisma.user.upsert({ where: { email: email.toLowerCase() }, update: { passwordHash, role: 'SUPER_ADMIN', status: 'APPROVED', reviewNote: null }, create: { name: 'System administrator', email: email.toLowerCase(), passwordHash, role: 'SUPER_ADMIN', status: 'APPROVED' } });
for (const type of [{ name: 'Government ID', required: true }, { name: 'Proof of address', required: true }, { name: 'Proof of ownership', required: true }, { name: 'Income statement', required: false }]) {
	await prisma.documentType.upsert({ where: { name: type.name }, update: { required: type.required, active: true }, create: type });
}
for (const product of [
	{ name: 'Asset-backed personal loan', description: 'Flexible financing secured by an eligible personal asset.', minAmount: 1000, maxAmount: 100000, minTermMonths: 6, maxTermMonths: 60, baseRate: 8.5 },
	{ name: 'Vehicle-backed loan', description: 'Financing for eligible vehicles subject to verification.', minAmount: 2500, maxAmount: 150000, minTermMonths: 12, maxTermMonths: 72, baseRate: 9.25 },
	{ name: 'Business equipment loan', description: 'Structured financing for documented business equipment.', minAmount: 5000, maxAmount: 500000, minTermMonths: 12, maxTermMonths: 84, baseRate: 10.5 }
]) {
	await prisma.loanProduct.upsert({ where: { name: product.name }, update: product, create: product });
}
console.log(`Super administrator provisioned: ${email.toLowerCase()}`);
await prisma.$disconnect();