require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const Stripe = require('stripe');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Setup ---
const db = new Database(path.join(__dirname, 'ideas.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS usernames (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id INTEGER NOT NULL,
    emoji TEXT NOT NULL CHECK(emoji IN ('poop','fire','brain','puke')),
    reactor_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(idea_id, reactor_hash, emoji)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS graffiti (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('draw','text')),
    data TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#2a2a2a',
    x_pct REAL NOT NULL,
    y_pct REAL NOT NULL,
    rotation REAL NOT NULL DEFAULT 0,
    username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// --- Encryption ---
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  : crypto.randomBytes(32);

if (!process.env.ENCRYPTION_KEY) {
  console.warn('WARNING: No ENCRYPTION_KEY set. Using random key (data won\'t persist across restarts).');
  console.log('Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { ciphertext: encrypted, iv: iv.toString('hex'), authTag };
}

function decrypt(ciphertext, ivHex, authTagHex) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// --- Stripe Setup ---
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const paymentTokens = new Map();

// --- Rate Limiting ---
const rateLimits = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// --- Middleware ---
app.post('/api/webhook', express.raw({ type: 'application/json' }), handleWebhook);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Prepared Statements ---
const insertIdea = db.prepare('INSERT INTO ideas (ciphertext, iv, auth_tag) VALUES (?, ?, ?)');
const getStream = db.prepare('SELECT id, ciphertext, created_at FROM ideas ORDER BY id DESC LIMIT 100');
const getIdeasByIds = db.prepare(`SELECT id, ciphertext, iv, auth_tag FROM ideas WHERE id IN (${Array(20).fill('?').join(',')})`);
const checkUsername = db.prepare('SELECT 1 FROM usernames WHERE username = ?');
const insertUsername = db.prepare('INSERT INTO usernames (username) VALUES (?)');
const insertReaction = db.prepare('INSERT OR IGNORE INTO reactions (idea_id, emoji, reactor_hash) VALUES (?, ?, ?)');
const getReactionCounts = db.prepare(`
  SELECT idea_id, emoji, COUNT(*) as count
  FROM reactions
  WHERE idea_id IN (${Array(20).fill('?').join(',')})
  GROUP BY idea_id, emoji
`);
const insertGraffiti = db.prepare('INSERT INTO graffiti (type, data, color, x_pct, y_pct, rotation, username) VALUES (?, ?, ?, ?, ?, ?, ?)');
const getAllGraffiti = db.prepare('SELECT id, type, data, color, x_pct, y_pct, rotation, username, created_at FROM graffiti ORDER BY id ASC');

const getStatsTotal = db.prepare('SELECT COUNT(*) as total FROM ideas');
const getStatsPeakHour = db.prepare(`
  SELECT strftime('%H', created_at) as hour, COUNT(*) as count
  FROM ideas GROUP BY hour ORDER BY count DESC LIMIT 1
`);
const getStatsLast24h = db.prepare(`
  SELECT COUNT(*) as count FROM ideas WHERE created_at > datetime('now', '-24 hours')
`);
const getTrending = db.prepare(`
  SELECT r.idea_id, i.ciphertext, i.iv, i.auth_tag, i.created_at,
         COUNT(*) as total_reactions
  FROM reactions r
  JOIN ideas i ON i.id = r.idea_id
  WHERE r.created_at > datetime('now', '-24 hours')
  GROUP BY r.idea_id
  ORDER BY total_reactions DESC
  LIMIT 5
`);

// --- Routes ---

// Claim a username
app.post('/api/claim-username', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Slow down! Try again in a minute.' });
  }

  const { username } = req.body;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required.' });
  }

  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 20) {
    return res.status(400).json({ error: 'Username must be 3-20 characters.' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Letters, numbers, and underscores only.' });
  }

  const exists = checkUsername.get(trimmed);
  if (exists) {
    return res.status(409).json({ error: 'Username taken. Try another.' });
  }

  try {
    insertUsername.run(trimmed);
    res.json({ ok: true, username: trimmed });
  } catch (err) {
    return res.status(409).json({ error: 'Username taken. Try another.' });
  }
});

// Flush an idea
app.post('/api/flush', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many flushes! Wait a minute.' });
  }

  const { idea, username } = req.body;
  if (!idea || typeof idea !== 'string') {
    return res.status(400).json({ error: 'Idea is required.' });
  }

  const trimmed = idea.trim();
  if (trimmed.length === 0 || trimmed.length > 1000) {
    return res.status(400).json({ error: 'Idea must be 1-1000 characters.' });
  }

  // Encrypt idea with username embedded
  const payload = username ? JSON.stringify({ username, idea: trimmed }) : trimmed;
  const { ciphertext, iv, authTag } = encrypt(payload);
  const result = insertIdea.run(ciphertext, iv, authTag);

  res.json({
    id: result.lastInsertRowid,
    ciphertext,
    created_at: new Date().toISOString()
  });
});

// Get the stream
app.get('/api/stream', (req, res) => {
  const ideas = getStream.all();
  res.json(ideas);
});

// Stats
app.get('/api/stats', (req, res) => {
  const total = getStatsTotal.get().total;
  const peakRow = getStatsPeakHour.get();
  const last24h = getStatsLast24h.get().count;

  res.json({
    total,
    peakHour: peakRow ? parseInt(peakRow.hour) : null,
    last24h,
    sewerDepth: Math.floor(total / 10)
  });
});

// Trending - most reacted ideas in last 24h (encrypted, no free peeks)
app.get('/api/trending', (req, res) => {
  const rows = getTrending.all();

  const trendingIds = rows.map(r => r.idea_id);
  if (trendingIds.length === 0) return res.json([]);

  // Get reaction breakdowns
  const paddedIds = [...trendingIds, ...Array(20 - trendingIds.length).fill(-1)];
  const reactionRows = getReactionCounts.all(...paddedIds);
  const reactionMap = {};
  for (const r of reactionRows) {
    if (!reactionMap[r.idea_id]) reactionMap[r.idea_id] = {};
    reactionMap[r.idea_id][r.emoji] = r.count;
  }

  const trending = rows.map(row => ({
    id: row.idea_id,
    ciphertext: row.ciphertext,
    reactions: reactionMap[row.idea_id] || {},
    total_reactions: row.total_reactions,
    created_at: row.created_at
  }));

  res.json(trending);
});

// Reactions - get counts
app.get('/api/reactions', (req, res) => {
  const idsParam = req.query.ids;
  if (!idsParam) return res.json({});

  const ids = idsParam.split(',').map(Number).filter(n => !isNaN(n)).slice(0, 20);
  if (ids.length === 0) return res.json({});

  const paddedIds = [...ids, ...Array(20 - ids.length).fill(-1)];
  const rows = getReactionCounts.all(...paddedIds);

  const result = {};
  for (const row of rows) {
    if (!result[row.idea_id]) result[row.idea_id] = {};
    result[row.idea_id][row.emoji] = row.count;
  }
  res.json(result);
});

// Reactions - add
app.post('/api/react', (req, res) => {
  const { idea_id, emoji, reactor_id } = req.body;

  if (!idea_id || !emoji || !reactor_id) {
    return res.status(400).json({ error: 'Missing fields.' });
  }

  const validEmojis = ['poop', 'fire', 'brain', 'puke'];
  if (!validEmojis.includes(emoji)) {
    return res.status(400).json({ error: 'Invalid reaction.' });
  }

  try {
    insertReaction.run(idea_id, emoji, reactor_id);
  } catch {
    // duplicate or constraint violation - that's fine
  }

  // Return updated counts for this idea
  const paddedIds = [idea_id, ...Array(19).fill(-1)];
  const rows = getReactionCounts.all(...paddedIds);
  const counts = {};
  for (const row of rows) {
    counts[row.emoji] = row.count;
  }
  res.json({ counts });
});

// Get all graffiti
app.get('/api/graffiti', (req, res) => {
  const items = getAllGraffiti.all();
  res.json(items);
});

// Add graffiti (free for everyone)
app.post('/api/graffiti', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many scribbles! Wait a minute.' });
  }

  const { type, data, color, x_pct, y_pct, rotation, username } = req.body;

  if (!type || !data) {
    return res.status(400).json({ error: 'Type and data required.' });
  }

  if (!['draw', 'text'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type.' });
  }

  if (type === 'text' && data.length > 100) {
    return res.status(400).json({ error: 'Text graffiti max 100 chars.' });
  }

  if (type === 'draw' && data.length > 50000) {
    return res.status(400).json({ error: 'Drawing too large.' });
  }

  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#2a2a2a';
  const safeX = Math.max(0, Math.min(100, Number(x_pct) || Math.random() * 80 + 10));
  const safeY = Math.max(0, Math.min(100, Number(y_pct) || Math.random() * 60 + 10));
  const safeRotation = Math.max(-15, Math.min(15, Number(rotation) || (Math.random() * 10 - 5)));

  try {
    const result = insertGraffiti.run(type, data, safeColor, safeX, safeY, safeRotation, username || 'anon');
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save graffiti.' });
  }
});

// Create Stripe Checkout session
app.post('/api/checkout', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Payments not configured. Set STRIPE_SECRET_KEY in .env' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/?cancelled=true`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

// Stripe webhook
async function handleWebhook(req, res) {
  if (!stripe) return res.status(503).send('Payments not configured');

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const token = jwt.sign(
      { decryptionsRemaining: 999999, sessionId: session.id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    paymentTokens.set(session.id, token);
  }

  res.json({ received: true });
}

// Check payment status
app.get('/api/check-payment', (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  const token = paymentTokens.get(session_id);
  if (token) {
    paymentTokens.delete(session_id);
    return res.json({ token });
  }

  res.json({ token: null });
});

// Decrypt ideas
app.post('/api/decrypt', (req, res) => {
  const { token, ids } = req.body;

  if (!token || !ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'Token and ids array required.' });
  }

  if (ids.length > 20) {
    return res.status(400).json({ error: 'Maximum 20 ideas per request.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token. Purchase again to decrypt more.' });
  }

  if (payload.decryptionsRemaining < ids.length) {
    return res.status(403).json({
      error: `Only ${payload.decryptionsRemaining} decryptions remaining.`,
      remaining: payload.decryptionsRemaining
    });
  }

  const paddedIds = [...ids.map(Number), ...Array(20 - ids.length).fill(-1)];
  const rows = getIdeasByIds.all(...paddedIds);

  const decrypted = rows.map(row => {
    try {
      const plaintext = decrypt(row.ciphertext, row.iv, row.auth_tag);
      // Try to parse as JSON (new format with username)
      try {
        const parsed = JSON.parse(plaintext);
        return { id: row.id, idea: parsed.idea, username: parsed.username };
      } catch {
        // Legacy format: plain string
        return { id: row.id, idea: plaintext, username: 'anonymous' };
      }
    } catch {
      return { id: row.id, idea: '[decryption failed]', username: 'unknown' };
    }
  });

  const newToken = jwt.sign(
    {
      decryptionsRemaining: payload.decryptionsRemaining - ids.length,
      sessionId: payload.sessionId
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  res.json({ ideas: decrypted, token: newToken, remaining: payload.decryptionsRemaining - ids.length });
});

// --- Start ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  The Porcelain Portal is open on http://localhost:${PORT}\n`);
  if (!stripe) console.log('  (Stripe not configured - payments disabled)\n');
});
