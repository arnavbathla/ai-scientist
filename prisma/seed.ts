import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@researchos.local";
  const password = "password123";
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name: "Demo Researcher" },
    create: {
      email,
      passwordHash,
      name: "Demo Researcher",
    },
  });

  // Seed one starter project (clearly marked as a starter, no fake completed runs).
  const existingProject = await prisma.project.findFirst({
    where: { userId: user.id, title: "Cellular aging research" },
  });
  if (!existingProject) {
    await prisma.project.create({
      data: {
        userId: user.id,
        title: "Cellular aging research",
        description:
          "Starter project for exploring safe high-level hypotheses about cellular rejuvenation.",
        domain: "General biology",
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seed complete. Demo user: ${email} / ${password}. Project: 'Cellular aging research'.`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
