const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Erstelle die Fitness-Studios
  const gyms = await Promise.all([
    prisma.gym.upsert({
      where: { id: 'karlsruhe-sued' },
      update: {},
      create: {
        id: 'karlsruhe-sued',
        name: 'Sportprinz Karlsruhe Süd',
        url: 'https://clubconnector.sovd.cloud/api/anwesende/47fc873e-1bc1-431a-9111-e66d5abefa67-070367/22',
      },
    }),
    prisma.gym.upsert({
      where: { id: 'freiburg-west' },
      update: {},
      create: {
        id: 'freiburg-west',
        name: 'Sportprinz Freiburg West',
        url: 'https://clubconnector.sovd.cloud/api/anwesende/47fc873e-1bc1-431a-9111-e66d5abefa67-070367/16',
      },
    }),
  ]);

  console.log(`✓ Created ${gyms.length} gyms`);


  // Keine Testdaten mehr! Nur Studios werden angelegt, falls nötig.
  console.log('✅ Studios angelegt. Keine Testdaten für occupancy.');
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
