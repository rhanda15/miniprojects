require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'ideas.db');
const SEED_BANK_PATH = path.join(__dirname, 'seed-bank.json');
const SEED_GRAFFITI_PATH = path.join(__dirname, 'seed-graffiti.json');

// --- Check if DB needs seeding ---
function needsSeed() {
  try {
    const db = new Database(DB_PATH);
    const count = db.prepare('SELECT COUNT(*) as c FROM ideas').get().c;
    db.close();
    return count === 0;
  } catch {
    return true;
  }
}

// --- Bulk seed (no delays, loads everything at once) ---
function bulkSeed() {
  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
    ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
    : null;

  if (!ENCRYPTION_KEY) {
    console.log('  Skipping seed: ENCRYPTION_KEY not set');
    return;
  }

  if (!fs.existsSync(SEED_BANK_PATH)) {
    console.log('  Skipping seed: seed-bank.json not found');
    return;
  }

  function encrypt(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return { ciphertext: encrypted, iv: iv.toString('hex'), authTag };
  }

  const seedBank = JSON.parse(fs.readFileSync(SEED_BANK_PATH, 'utf8'));
  const seedGraffiti = fs.existsSync(SEED_GRAFFITI_PATH)
    ? JSON.parse(fs.readFileSync(SEED_GRAFFITI_PATH, 'utf8'))
    : [];

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Ensure tables exist (normally created by server.js, but we run first)
  db.exec(`CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS usernames (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id INTEGER NOT NULL, emoji TEXT NOT NULL CHECK(emoji IN ('poop','fire','brain','puke')),
    reactor_hash TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(idea_id, reactor_hash, emoji)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS graffiti (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('draw','text')), data TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#2a2a2a', x_pct REAL NOT NULL, y_pct REAL NOT NULL,
    rotation REAL NOT NULL DEFAULT 0, username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const insertIdea = db.prepare('INSERT INTO ideas (ciphertext, iv, auth_tag) VALUES (?, ?, ?)');
  const insertUsername = db.prepare('INSERT OR IGNORE INTO usernames (username) VALUES (?)');
  const insertReaction = db.prepare('INSERT OR IGNORE INTO reactions (idea_id, emoji, reactor_hash) VALUES (?, ?, ?)');
  const insertGraffiti = db.prepare('INSERT INTO graffiti (type, data, color, x_pct, y_pct, rotation, username) VALUES (?, ?, ?, ?, ?, ?, ?)');

  const emojis = ['fire', 'brain', 'poop', 'puke'];

  // Bulk insert all ideas in a transaction
  const insertAll = db.transaction(() => {
    const ideaIds = [];

    // Shuffle seed bank
    const order = [...seedBank.keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    for (const idx of order) {
      const take = seedBank[idx];
      insertUsername.run(take.username);
      const payload = JSON.stringify({ username: take.username, idea: take.text });
      const { ciphertext, iv, authTag } = encrypt(payload);
      const result = insertIdea.run(ciphertext, iv, authTag);
      ideaIds.push(Number(result.lastInsertRowid));
    }

    // Seed reactions (3-8 per idea on ~60% of ideas)
    let reactionCount = 0;
    for (const id of ideaIds) {
      if (Math.random() > 0.6) continue;
      const numReactions = Math.floor(Math.random() * 6) + 3;
      for (let r = 0; r < numReactions; r++) {
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        insertReaction.run(id, emoji, crypto.randomUUID());
        reactionCount++;
      }
    }

    // Seed graffiti
    for (const entry of seedGraffiti) {
      const x = 5 + Math.random() * 90;
      const y = 5 + Math.random() * 80;
      const rotation = Math.random() * 24 - 12;
      insertGraffiti.run('text', entry.text, entry.color, x, y, rotation, entry.username || 'anon');
    }

    return { ideas: ideaIds.length, reactions: reactionCount, graffiti: seedGraffiti.length };
  });

  const counts = insertAll();
  db.close();

  console.log(`  Seeded ${counts.ideas} ideas, ${counts.reactions} reactions, ${counts.graffiti} graffiti`);
}

// --- Main ---
if (needsSeed()) {
  console.log('Empty database detected. Bulk seeding...');
  bulkSeed();
  console.log('Seed complete. Starting server...\n');
} else {
  console.log('Database already has content. Starting server...\n');
}

require('./server');
