const { PrismaClient } = require('@prisma/client');
const gyms = require('../config/gyms.json');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Erstelle die Fitness-Studios
  const createdGyms = await Promise.all(
    gyms.map((gym) =>
      prisma.gym.upsert({
        where: { id: gym.id },
        update: { name: gym.name, url: gym.url },
        create: {
          id: gym.id,
          name: gym.name,
          url: gym.url,
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
