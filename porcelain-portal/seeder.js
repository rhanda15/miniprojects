require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// --- Config ---
const DB_PATH = path.join(__dirname, 'ideas.db');
const SEED_BANK_PATH = path.join(__dirname, 'seed-bank.json');
const SEED_GRAFFITI_PATH = path.join(__dirname, 'seed-graffiti.json');
const STATE_PATH = path.join(__dirname, 'seed-state.json');

// --- Encryption (same as server.js) ---
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  : null;

if (!ENCRYPTION_KEY) {
  console.error('ERROR: ENCRYPTION_KEY not set in .env. Seeder needs the same key as the server.');
  process.exit(1);
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { ciphertext: encrypted, iv: iv.toString('hex'), authTag };
}

// --- Database ---
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const insertIdea = db.prepare('INSERT INTO ideas (ciphertext, iv, auth_tag) VALUES (?, ?, ?)');
const insertUsername = db.prepare('INSERT OR IGNORE INTO usernames (username) VALUES (?)');
const insertReaction = db.prepare('INSERT OR IGNORE INTO reactions (idea_id, emoji, reactor_hash) VALUES (?, ?, ?)');
const insertGraffiti = db.prepare('INSERT INTO graffiti (type, data, color, x_pct, y_pct, rotation, username) VALUES (?, ?, ?, ?, ?, ?, ?)');
const getRecentIds = db.prepare('SELECT id FROM ideas ORDER BY id DESC LIMIT 50');

// --- Load seed banks ---
console.log('Loading seed banks...');
const seedBank = JSON.parse(fs.readFileSync(SEED_BANK_PATH, 'utf8'));
const seedGraffiti = JSON.parse(fs.readFileSync(SEED_GRAFFITI_PATH, 'utf8'));
console.log(`Loaded ${seedBank.length} takes, ${seedGraffiti.length} graffiti entries`);

// --- State management ---
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { postIndex: 0, graffitiIndex: 0, totalPosted: 0, shuffleOrder: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// --- Shuffle array (Fisher-Yates) ---
function shuffle(arr) {
  const a = [...arr.keys()];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Weighted random emoji ---
function randomEmoji() {
  const r = Math.random();
  if (r < 0.35) return 'fire';
  if (r < 0.65) return 'brain';
  if (r < 0.85) return 'poop';
  return 'puke';
}

// --- Random helpers ---
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Get delay based on ramp phase ---
function getDelay(totalPosted) {
  if (totalPosted < 100) {
    // Burst phase: 1-3 min
    return randomBetween(60, 180) * 1000;
  } else if (totalPosted < 500) {
    // Active phase: 3-8 min
    return randomBetween(180, 480) * 1000;
  } else {
    // Steady state: 8-25 min
    return randomBetween(480, 1500) * 1000;
  }
}

// --- Post an idea ---
function postIdea(text, username) {
  insertUsername.run(username);
  const payload = JSON.stringify({ username, idea: text });
  const { ciphertext, iv, authTag } = encrypt(payload);
  const result = insertIdea.run(ciphertext, iv, authTag);
  return Number(result.lastInsertRowid);
}

// --- Seed reactions on recent ideas ---
function seedReactions() {
  const recentIds = getRecentIds.all().map(r => r.id);
  if (recentIds.length === 0) return 0;

  const numReactions = Math.floor(randomBetween(2, 7));
  let seeded = 0;

  for (let i = 0; i < numReactions; i++) {
    const targetId = recentIds[Math.floor(Math.random() * recentIds.length)];
    const emoji = randomEmoji();
    const reactorHash = crypto.randomUUID();
    try {
      insertReaction.run(targetId, emoji, reactorHash);
      seeded++;
    } catch { /* duplicate, ignore */ }
  }
  return seeded;
}

// --- Post a graffiti entry ---
function postGraffiti(entry) {
  const x = randomBetween(5, 95);
  const y = randomBetween(5, 85);
  const rotation = randomBetween(-12, 12);
  insertGraffiti.run('text', entry.text, entry.color, x, y, rotation, entry.username || 'anon');
}

// --- Main loop ---
let shuttingDown = false;

async function run() {
  const state = loadState();

  // Initialize or reset shuffle order
  if (!state.shuffleOrder || state.shuffleOrder.length !== seedBank.length) {
    console.log('Shuffling seed bank...');
    state.shuffleOrder = shuffle(seedBank);
    state.postIndex = 0;
    saveState(state);
  }

  // Shuffle graffiti order
  let graffitiOrder = shuffle(seedGraffiti);
  let graffitiIdx = state.graffitiIndex || 0;

  console.log(`\nSeeder starting. ${state.totalPosted} total posted so far.`);
  console.log(`Phase: ${state.totalPosted < 100 ? 'BURST (1-3 min)' : state.totalPosted < 500 ? 'ACTIVE (3-8 min)' : 'STEADY (8-25 min)'}\n`);

  while (!shuttingDown) {
    // Wrap around if we've used all takes
    if (state.postIndex >= state.shuffleOrder.length) {
      console.log('\nBank exhausted. Reshuffling...');
      state.shuffleOrder = shuffle(seedBank);
      state.postIndex = 0;
    }

    // Get next take
    const idx = state.shuffleOrder[state.postIndex];
    const take = seedBank[idx];

    // Post it
    const id = postIdea(take.text, take.username);
    state.postIndex++;
    state.totalPosted++;
    console.log(`[${new Date().toISOString()}] #${id} @${take.username}: ${take.text.substring(0, 70)}${take.text.length > 70 ? '...' : ''}`);

    // Seed reactions
    const reacted = seedReactions();
    if (reacted > 0) {
      console.log(`  + ${reacted} reactions seeded`);
    }

    // Every 10 posts, add 1-2 graffiti
    if (state.totalPosted % 10 === 0 && graffitiIdx < graffitiOrder.length) {
      const numGraffiti = Math.random() < 0.5 ? 1 : 2;
      for (let g = 0; g < numGraffiti && graffitiIdx < graffitiOrder.length; g++) {
        const gIdx = graffitiOrder[graffitiIdx];
        postGraffiti(seedGraffiti[gIdx]);
        graffitiIdx++;
        console.log(`  + graffiti: "${seedGraffiti[gIdx].text}"`);
      }
      state.graffitiIndex = graffitiIdx;
    }

    // Save state
    saveState(state);

    // Wait
    const delay = getDelay(state.totalPosted);
    const mins = (delay / 60000).toFixed(1);
    console.log(`  next post in ${mins} min`);

    await sleep(delay);
  }

  console.log('\nSeeder stopped. State saved.');
  db.close();
}

// --- Graceful shutdown ---
process.on('SIGINT', () => { shuttingDown = true; });
process.on('SIGTERM', () => { shuttingDown = true; });

run().catch(err => {
  console.error('Seeder fatal error:', err);
  db.close();
  process.exit(1);
});
