import 'dotenv/config';

import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/infrastructure/database/generated/prisma/client.js';

const identifier = process.argv[2]?.normalize('NFKC').trim().toLowerCase();
const roleCode = process.argv[3]?.trim().toUpperCase();

if (!identifier || !['ADMIN', 'CONTENT_AUDITOR'].includes(roleCode)) {
  console.error(
    'Usage: npm run platform:grant -- <email-or-username> <ADMIN|CONTENT_AUDITOR>',
  );
  process.exitCode = 64;
} else if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exitCode = 78;
} else {
  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(process.env.DATABASE_URL),
    log: [],
  });
  try {
    const user = await prisma.user.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [
          { emailNormalized: identifier },
          { usernameNormalized: identifier },
        ],
      },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!user) {
      throw new Error('No active user matches the supplied identifier');
    }
    if (!user.emailVerifiedAt) {
      throw new Error('Platform roles require a verified email account');
    }
    const role = await prisma.role.findUnique({
      where: { scope_code: { scope: 'PLATFORM', code: roleCode } },
      select: { id: true },
    });
    if (!role) {
      throw new Error(`Seeded platform role ${roleCode} is missing`);
    }
    await prisma.platformRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    console.log(`Assigned ${roleCode} to user ${user.id}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Role assignment failed');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
