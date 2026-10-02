import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@coloan.tnl.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin@coloan2024!'; // Change this!
  const name = 'Coloan Admin';

  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash, role: 'ADMIN', status: 'APPROVED', reviewNote: null },
    create: { name, email: email.toLowerCase(), passwordHash, role: 'ADMIN', status: 'APPROVED' }
  });

  console.log(`Admin user created/updated: ${user.email} (${user.role})`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});