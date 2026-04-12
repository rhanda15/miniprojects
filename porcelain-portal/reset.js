require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'ideas.db');
const STATE_PATH = path.join(__dirname, 'seed-state.json');

if (!fs.existsSync(DB_PATH)) {
  console.log('No database found. Nothing to reset.');
  process.exit(0);
}

const db = new Database(DB_PATH);

console.log('Resetting database...');

// Get counts before reset
const ideas = db.prepare('SELECT COUNT(*) as c FROM ideas').get().c;
const reactions = db.prepare('SELECT COUNT(*) as c FROM reactions').get().c;
const usernames = db.prepare('SELECT COUNT(*) as c FROM usernames').get().c;
const graffiti = db.prepare('SELECT COUNT(*) as c FROM graffiti').get().c;

// Clear all tables
db.exec('DELETE FROM reactions');
db.exec('DELETE FROM ideas');
db.exec('DELETE FROM usernames');
db.exec('DELETE FROM graffiti');
db.exec('DELETE FROM consumed_sessions');

// Reset autoincrement counters
db.exec("DELETE FROM sqlite_sequence WHERE name IN ('ideas', 'reactions', 'graffiti')");

db.close();

// Remove seeder state
if (fs.existsSync(STATE_PATH)) {
  fs.unlinkSync(STATE_PATH);
  console.log('Removed seed-state.json');
}

console.log(`\nReset complete:`);
console.log(`  - ${ideas} ideas deleted`);
console.log(`  - ${reactions} reactions deleted`);
console.log(`  - ${usernames} usernames deleted`);
console.log(`  - ${graffiti} graffiti deleted`);
console.log(`\nReady for fresh launch. Run: npm run seed && npm start`);
