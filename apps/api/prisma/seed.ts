import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Eski İngilizce → Türkçe isim taşıma */
const RENAME_MAP: Array<{ from: string; to: string; groupName: string }> = [
  { from: "Core Network", to: "Çekirdek Ağ", groupName: "Ağ" },
  { from: "Internet Gateway", to: "İnternet Geçidi", groupName: "Ağ" },
  { from: "DNS", to: "DNS", groupName: "Altyapı" },
  { from: "Customer Portal", to: "Müşteri Portalı", groupName: "Uygulamalar" },
  { from: "Network", to: "Ağ", groupName: "Ağ" },
  { from: "Infrastructure", to: "Altyapı", groupName: "Altyapı" },
  { from: "Applications", to: "Uygulamalar", groupName: "Uygulamalar" },
];

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
    update: {
      description: "Olfe ağ ve altyapı durumu",
    },
    create: {
      slug: "olfe",
      name: "Olfe",
      description: "Olfe ağ ve altyapı durumu",
      brandColor: "#0B5FFF",
    },
  });

  const incinet = await prisma.tenant.upsert({
    where: { slug: "incinet" },
    update: {
      description: "İncinet ISS servis durumu",
    },
    create: {
      slug: "incinet",
      name: "İncinet ISS",
      description: "İncinet ISS servis durumu",
      brandColor: "#0F766E",
    },
  });

  const defaultServices = [
    { name: "Çekirdek Ağ", groupName: "Ağ", sortOrder: 1 },
    { name: "İnternet Geçidi", groupName: "Ağ", sortOrder: 2 },
    { name: "DNS", groupName: "Altyapı", sortOrder: 3 },
    { name: "Müşteri Portalı", groupName: "Uygulamalar", sortOrder: 4 },
  ];

  const defaultOperators = [
    "Türk Telekom",
    "Vodafone",
    "Türknet",
    "Belcloud",
    "Superonline",
    "Turkcell",
  ];

  for (const name of defaultOperators) {
    await prisma.operator.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const tenant of [olfe, incinet]) {
    // Mevcut İngilizce isimleri Türkçeleştir
    for (const map of RENAME_MAP) {
      await prisma.service.updateMany({
        where: { tenantId: tenant.id, name: map.from },
        data: { name: map.to, groupName: map.groupName },
      });
    }
    // Eski İngilizce grup adlarını düzelt
    await prisma.service.updateMany({
      where: { tenantId: tenant.id, groupName: "Network" },
      data: { groupName: "Ağ" },
    });
    await prisma.service.updateMany({
      where: { tenantId: tenant.id, groupName: "Infrastructure" },
      data: { groupName: "Altyapı" },
    });
    await prisma.service.updateMany({
      where: { tenantId: tenant.id, groupName: "Applications" },
      data: { groupName: "Uygulamalar" },
    });

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
