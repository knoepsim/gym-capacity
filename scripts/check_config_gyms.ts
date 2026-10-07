import gyms from '../config/gyms.json';

// Test hours logic for Freiburg-West and Karlsruhe-Sued
const testGyms = gyms as any[];

console.log('Current gyms config count:', testGyms.length);
for (const g of testGyms) {
  console.log(`- ${g.id}: ${g.name} (has openingHours: ${!!g.openingHours})`);
}
