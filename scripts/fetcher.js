#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Fitness-Studios mit ihren eindeutigen IDs und Abruf-URLs
 * Diese Config kannst du später in eine Datenbank verschieben
 */
const GYMS = [
  {
    id: 'karlsruhe-sued',
    name: 'Sportprinz Karlsruhe Süd',
    url: 'https://clubconnector.sovd.cloud/api/anwesende/47fc873e-1bc1-431a-9111-e66d5abefa67-070367/22'
  },
  {
    id: 'freiburg-west',
    name: 'Sportprinz Freiburg West',
    url: 'https://clubconnector.sovd.cloud/api/anwesende/47fc873e-1bc1-431a-9111-e66d5abefa67-070367/16'
  }
];

/**
 * Erstelle oder aktualisiere Gym-Einträge in der Datenbank
 */
async function initializeGyms() {
  for (const gym of GYMS) {
    await prisma.gym.upsert({
      where: { id: gym.id },
      update: { name: gym.name, url: gym.url },
      create: { id: gym.id, name: gym.name, url: gym.url }
    });
  }
}

/**
 * Hole aktuelle Auslastungsdaten von der API ab
 */
async function fetchGymData() {
  console.log(`[${new Date().toISOString()}] Starte Datenabruf...`);

  for (const gym of GYMS) {
    try {
      const response = await fetch(gym.url, {
        method: 'GET',
        headers: { 'User-Agent': 'GymCapacityMonitor/1.0' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Validiere die Antwort
      if (typeof data.count !== 'number' || typeof data.maxCount !== 'number') {
        throw new Error(`Ungültiges Datenformat: ${JSON.stringify(data)}`);
      }

      // Speichere in der Datenbank
      await prisma.occupancy.create({
        data: {
          gymId: gym.id,
          count: data.count,
          maxCount: data.maxCount,
          timestamp: new Date()
        }
      });

      const occupancyPercent = Math.round((data.count / data.maxCount) * 100);
      console.log(
        `✓ ${gym.name}: ${data.count}/${data.maxCount} (${occupancyPercent}%)`
      );
    } catch (error) {
      console.error(`✗ Fehler bei ${gym.name}:`, error.message);
    }
  }

  console.log(`[${new Date().toISOString()}] Datenabruf abgeschlossen.\n`);
}

/**
 * Hauptfunktion: Initialisiere Gyms und hole Daten ab
 */
async function main() {
  try {
    await initializeGyms();
    await fetchGymData();
  } catch (error) {
    console.error('Fataler Fehler:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
