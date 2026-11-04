const { PrismaClient } = require('@prisma/client');
const gyms = require('../config/gyms.json');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Gym IDs may change in the config; the upstream URL is the stable key. Renaming the row keeps all
  // stored occupancy history, because the foreign keys cascade on update.
  for (const gym of gyms) {
    const existing = await prisma.gym.findUnique({ where: { url: gym.url } });
    if (existing && existing.id !== gym.id) {
      await prisma.$executeRaw`UPDATE "Gym" SET "id" = ${gym.id} WHERE "id" = ${existing.id}`;
      console.log(`↻ Renamed gym ${existing.id} → ${gym.id}`);
    }
  }

  // Erstelle die Fitness-Studios
  const createdGyms = await Promise.all(
    gyms.map((gym) =>
      prisma.gym.upsert({
        where: { id: gym.id },
        update: { name: gym.name, url: gym.url, region: gym.region, city: gym.city },
        create: {
          id: gym.id,
          name: gym.name,
          url: gym.url,
          region: gym.region,
          city: gym.city,
        },
      })
    )
  );

  console.log(`✓ Created ${createdGyms.length} gyms`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
