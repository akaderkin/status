import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@olfe.net";
  const password = process.env.ADMIN_PASSWORD || "changeme123";

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash, name: "Admin" },
  });

  const olfe = await prisma.tenant.upsert({
    where: { slug: "olfe" },
    update: {},
    create: {
      slug: "olfe",
      name: "Olfe",
      description: "Olfe network and infrastructure status",
      brandColor: "#0B5FFF",
    },
  });

  const incinet = await prisma.tenant.upsert({
    where: { slug: "incinet" },
    update: {},
    create: {
      slug: "incinet",
      name: "İncinet ISS",
      description: "İncinet ISS service status",
      brandColor: "#0F766E",
    },
  });

  const defaultServices = [
    { name: "Core Network", groupName: "Network", sortOrder: 1 },
    { name: "Internet Gateway", groupName: "Network", sortOrder: 2 },
    { name: "DNS", groupName: "Infrastructure", sortOrder: 3 },
    { name: "Customer Portal", groupName: "Applications", sortOrder: 4 },
  ];

  for (const tenant of [olfe, incinet]) {
    for (const svc of defaultServices) {
      const existing = await prisma.service.findFirst({
        where: { tenantId: tenant.id, name: svc.name },
      });
      if (!existing) {
        await prisma.service.create({
          data: {
            tenantId: tenant.id,
            name: svc.name,
            groupName: svc.groupName,
            sortOrder: svc.sortOrder,
            sourceType: "manual",
            status: "operational",
          },
        });
      }
    }
  }

  console.log("Seed complete:");
  console.log(`  Admin: ${email}`);
  console.log(`  Tenants: olfe (${olfe.id}), incinet (${incinet.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
