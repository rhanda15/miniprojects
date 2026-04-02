// === DOM Elements ===
const ideaInput = document.getElementById('idea-input');
const charCount = document.getElementById('char-count');
const flushBtn = document.getElementById('flush-btn');
const toilet = document.getElementById('toilet');
const water = document.getElementById('water');
const payBtn = document.getElementById('pay-btn');
const tokenInfo = document.getElementById('token-info');
const remainingCount = document.getElementById('remaining-count');
const streamList = document.getElementById('stream-list');
const streamCount = document.getElementById('stream-count');
const usernameSection = document.getElementById('username-section');
const usernameDisplay = document.getElementById('username-display');
const usernameInput = document.getElementById('username-input');
const claimBtn = document.getElementById('claim-btn');
const currentUsernameEl = document.getElementById('current-username');
const muteBtn = document.getElementById('mute-btn');
const sewerDecorations = document.getElementById('sewer-decorations');

// === State ===
let decryptToken = localStorage.getItem('porcelain_token');
let currentUsername = localStorage.getItem('porcelain_username');
let reactorId = localStorage.getItem('porcelain_reactor');
let ideas = [];
let isMuted = localStorage.getItem('porcelain_muted') === 'true';

if (!reactorId) {
  reactorId = crypto.randomUUID();
  localStorage.setItem('porcelain_reactor', reactorId);
}

// ============================================================
// USERNAME SYSTEM
// ============================================================

function initUsername() {
  if (currentUsername) {
    usernameSection.style.display = 'none';
    usernameDisplay.style.display = 'block';
    currentUsernameEl.textContent = '@' + currentUsername;
    flushBtn.disabled = false;
  } else {
    usernameSection.style.display = 'flex';
    usernameDisplay.style.display = 'none';
    flushBtn.disabled = true;
  }
}

claimBtn.addEventListener('click', claimUsername);
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') claimUsername();
});

async function claimUsername() {
  const name = usernameInput.value.trim();
  if (!name) return;

  claimBtn.disabled = true;
  claimBtn.textContent = '...';

  try {
    const res = await fetch('/api/claim-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentUsername = data.username;
    localStorage.setItem('porcelain_username', currentUsername);
    initUsername();
    notify('Handle claimed: @' + currentUsername, 'success');
  } catch (err) {
    notify(err.message, 'error');
  } finally {
    claimBtn.disabled = false;
    claimBtn.textContent = 'CLAIM';
  }
}

// ============================================================
// CHARACTER COUNTER
// ============================================================

ideaInput.addEventListener('input', () => {
  const len = ideaInput.value.length;
  charCount.textContent = len;
  const counter = charCount.parentElement;
  counter.classList.remove('warning', 'danger');
  if (len > 950) counter.classList.add('danger');
  else if (len > 800) counter.classList.add('warning');
});

// ============================================================
// FLUSH
// ============================================================

flushBtn.addEventListener('click', flushIdea);

ideaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    flushIdea();
  }
});

async function flushIdea() {
  const idea = ideaInput.value.trim();
  if (!idea || !currentUsername) return;
  if (idea.length > 1000) {
    notify('Too long! 1000 chars max.', 'error');
    return;
  }

  flushBtn.disabled = true;
  flushBtn.textContent = 'FLUSHING...';

  try {
    const res = await fetch('/api/flush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea, username: currentUsername })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Flush failed');

    // Animation + sound
    toilet.classList.add('flushing');
    water.classList.add('swirl');
    SoundEngine.playPlop();
    setTimeout(() => SoundEngine.playFlush(), 150);

    setTimeout(() => {
      toilet.classList.remove('flushing');
      water.classList.remove('swirl');
    }, 1200);

    ideaInput.value = '';
    charCount.textContent = '0';
    charCount.parentElement.classList.remove('warning', 'danger');

    addToStream({ id: data.id, ciphertext: data.ciphertext, created_at: data.created_at }, true);

    flushBtn.textContent = 'FLUSHED!';
    flushBtn.classList.add('flushed');
    setTimeout(() => {
      flushBtn.textContent = 'FLUSH IT';
      flushBtn.classList.remove('flushed');
    }, 1500);

    loadStats();
  } catch (err) {
    notify(err.message, 'error');
    flushBtn.textContent = 'FLUSH IT';
  } finally {
    flushBtn.disabled = false;
  }
}

// ============================================================
// STREAM
// ============================================================

async function loadStream() {
  try {
    const res = await fetch('/api/stream');
    const data = await res.json();
    ideas = data;
    renderStream();
  } catch {
    streamList.innerHTML = '<div class="stream-empty">failed to load the sewer...<br>try refreshing</div>';
  }
}

function renderStream() {
  if (ideas.length === 0) {
    streamList.innerHTML = '<div class="stream-empty">the sewer is empty...<br>be the first to flush</div>';
    streamCount.textContent = '0 ideas flushed into the void';
    return;
  }

  streamList.innerHTML = ideas.map(idea => createEntryHTML(idea)).join('');
  streamCount.textContent = `${ideas.length} idea${ideas.length !== 1 ? 's' : ''} flushed into the void`;
  updateDecryptableState();
}

function createEntryHTML(idea) {
  const time = formatTime(idea.created_at);
  const displayCipher = formatCipher(idea.ciphertext);
  return `
    <div class="stream-entry" data-id="${idea.id}">
      <span class="entry-time">${time}</span>
      <span class="entry-cipher">${displayCipher}</span>
    </div>
  `;
}

function addToStream(idea, isNew = false) {
  ideas.unshift(idea);
  if (ideas.length > 100) ideas.pop();

  // Remove empty state if present
  const empty = streamList.querySelector('.stream-empty');
  if (empty) empty.remove();

  const temp = document.createElement('div');
  temp.innerHTML = createEntryHTML(idea);
  const entry = temp.firstElementChild;
  if (isNew) entry.classList.add('new-entry');

  streamList.prepend(entry);
  updateDecryptableState();

  while (streamList.children.length > 102) {
    streamList.removeChild(streamList.lastChild);
  }

  streamCount.textContent = `${ideas.length} idea${ideas.length !== 1 ? 's' : ''} flushed into the void`;
}

function formatCipher(hex) {
  const chars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
  let garbled = '';
  for (let i = 0; i < Math.min(hex.length, 60); i++) {
    if (i % 4 === 0 && i > 0) {
      garbled += chars[parseInt(hex[i], 16) % chars.length];
    } else {
      garbled += hex[i];
    }
  }
  return garbled + (hex.length > 60 ? '...' : '');
}

function formatTime(isoString) {
  const d = new Date(isoString);
  const diff = Date.now() - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

// ============================================================
// PAYMENT
// ============================================================

payBtn.addEventListener('click', async () => {
  payBtn.disabled = true;
  payBtn.textContent = 'REDIRECTING...';

  try {
    const res = await fetch('/api/checkout', { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 503) {
        notify('Payments not configured yet. Set up Stripe in .env', 'info');
      } else {
        throw new Error(data.error || 'Checkout failed');
      }
      return;
    }

    window.location.href = data.url;
  } catch (err) {
    notify(err.message, 'error');
  } finally {
    payBtn.disabled = false;
    payBtn.textContent = 'UNLOCK ALL IDEAS - $1.99';
  }
});

function checkPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const cancelled = params.get('cancelled');

  if (cancelled) {
    notify('Payment cancelled. Your ideas remain encrypted.', 'info');
    window.history.replaceState({}, '', '/');
    return;
  }

  if (sessionId) {
    pollForToken(sessionId);
    window.history.replaceState({}, '', '/');
  }
}

async function pollForToken(sessionId, attempts = 0) {
  if (attempts > 30) {
    notify('Payment verification timed out. Refresh the page.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/check-payment?session_id=${sessionId}`);
    const data = await res.json();

    if (data.token) {
      decryptToken = data.token;
      localStorage.setItem('porcelain_token', data.token);
      updateTokenUI();
      updateDecryptableState();
      notify('Payment successful! Click ideas to decrypt them.', 'success');
      return;
    }
  } catch { /* retry */ }

  setTimeout(() => pollForToken(sessionId, attempts + 1), 1000);
}

function updateTokenUI() {
  if (!decryptToken) {
    tokenInfo.style.display = 'none';
    payBtn.style.display = '';
    return;
  }

  try {
    const payload = JSON.parse(atob(decryptToken.split('.')[1]));
    const remaining = payload.decryptionsRemaining;

    if (remaining <= 0) {
      decryptToken = null;
      localStorage.removeItem('porcelain_token');
      tokenInfo.style.display = 'none';
      payBtn.style.display = '';
      notify('All decryptions used! Purchase again to read more.', 'info');
      return;
    }

    remainingCount.textContent = remaining;
    tokenInfo.style.display = 'block';
    payBtn.style.display = 'none';

    if (payload.exp && payload.exp * 1000 < Date.now()) {
      decryptToken = null;
      localStorage.removeItem('porcelain_token');
      tokenInfo.style.display = 'none';
      payBtn.style.display = '';
    }
  } catch {
    decryptToken = null;
    localStorage.removeItem('porcelain_token');
  }
}

function updateDecryptableState() {
  const entries = streamList.querySelectorAll('.stream-entry');
  entries.forEach(entry => {
    if (decryptToken && !entry.classList.contains('decrypted')) {
      entry.classList.add('decryptable');
      entry.onclick = () => decryptEntry(entry);
    } else if (!decryptToken) {
      entry.classList.remove('decryptable');
      entry.onclick = null;
    }
  });
}

async function decryptEntry(entry) {
  if (!decryptToken || entry.classList.contains('decrypted')) return;

  const id = parseInt(entry.dataset.id);
  try {
    const res = await fetch('/api/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: decryptToken, ids: [id] })
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        decryptToken = null;
        localStorage.removeItem('porcelain_token');
        updateTokenUI();
        updateDecryptableState();
      }
      throw new Error(data.error || 'Decryption failed');
    }

    decryptToken = data.token;
    localStorage.setItem('porcelain_token', data.token);
    updateTokenUI();

    if (data.ideas && data.ideas.length > 0) {
      const item = data.ideas[0];
      const cipher = entry.querySelector('.entry-cipher');
      cipher.innerHTML = `<span class="entry-username">@${item.username}:</span> ${escapeHtml(item.idea)}`;
      entry.classList.remove('decryptable');
      entry.classList.add('decrypted');
      entry.onclick = null;

      // Add reaction bar
      addReactionBar(entry, id);
    }
  } catch (err) {
    notify(err.message, 'error');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// REACTIONS
// ============================================================

const EMOJI_MAP = {
  poop: '\u{1F4A9}',
  fire: '\u{1F525}',
  brain: '\u{1F9E0}',
  puke: '\u{1F92E}'
};

const myReactions = new Set(JSON.parse(localStorage.getItem('porcelain_reactions') || '[]'));

function saveMyReactions() {
  localStorage.setItem('porcelain_reactions', JSON.stringify([...myReactions]));
}

async function addReactionBar(entry, ideaId) {
  const bar = document.createElement('div');
  bar.className = 'reaction-bar';

  // Fetch existing counts
  let counts = {};
  try {
    const res = await fetch(`/api/reactions?ids=${ideaId}`);
    const data = await res.json();
    counts = data[ideaId] || {};
  } catch { /* no counts */ }

  for (const [key, emoji] of Object.entries(EMOJI_MAP)) {
    const btn = document.createElement('button');
    btn.className = 'reaction-btn';
    const reactionKey = `${ideaId}:${key}`;
    if (myReactions.has(reactionKey)) btn.classList.add('reacted');

    const count = counts[key] || 0;
    btn.innerHTML = `${emoji} <span class="reaction-count">${count}</span>`;

    btn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idea_id: ideaId, emoji: key, reactor_id: reactorId })
        });
        const data = await res.json();
        if (data.counts) {
          btn.querySelector('.reaction-count').textContent = data.counts[key] || 0;
          myReactions.add(reactionKey);
          btn.classList.add('reacted');
          saveMyReactions();
        }
      } catch { /* silent */ }
    });

    bar.appendChild(btn);
  }

  entry.appendChild(bar);
}

// ============================================================
// STATS
// ============================================================

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();

    document.getElementById('stat-total').textContent = data.total;
    document.getElementById('stat-depth').textContent = data.sewerDepth + 'm';
    document.getElementById('stat-today').textContent = data.last24h;

    if (data.peakHour !== null) {
      const h = data.peakHour;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour12 = h % 12 || 12;
      document.getElementById('stat-peak').textContent = hour12 + ampm;
    } else {
      document.getElementById('stat-peak').textContent = '--';
    }
  } catch { /* silent */ }
}

// ============================================================
// SOUND ENGINE (Web Audio API)
// ============================================================

const SoundEngine = {
  ctx: null,
  dripInterval: null,

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.startDrips();
  },

  playFlush() {
    if (!this.ctx || isMuted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // White noise for water rush
    const bufferSize = ctx.sampleRate * 1.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + 1.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.1);
    gain.gain.setValueAtTime(0.25, now + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 1.5);

    // Low rumble
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 1.2);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.1, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 1.3);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1.3);
  },

  playPlop() {
    if (!this.ctx || isMuted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(250, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  },

  playDrip() {
    if (!this.ctx || isMuted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const freq = 1200 + Math.random() * 1200;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.05);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  },

  playSqueak() {
    if (!this.ctx || isMuted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.08;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(2000 + Math.random() * 500, t);
      osc.frequency.exponentialRampToValueAtTime(1500, t + 0.04);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.03, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    }
  },

  startDrips() {
    const scheduleDrip = () => {
      this.playDrip();
      this.dripInterval = setTimeout(scheduleDrip, 3000 + Math.random() * 6000);
    };
    this.dripInterval = setTimeout(scheduleDrip, 2000);
  }
};

// ============================================================
// SEWER ANIMATIONS
// ============================================================

const SewerAnimations = {
  floaterInterval: null,
  ratTimeout: null,

  start() {
    this.scheduleFloater();
    this.scheduleRat();
  },

  scheduleFloater() {
    const spawn = () => {
      this.spawnFloater();
      this.floaterInterval = setTimeout(spawn, 2000 + Math.random() * 3000);
    };
    this.floaterInterval = setTimeout(spawn, 1000);
  },

  spawnFloater() {
    if (!sewerDecorations) return;

    const types = ['floater-turd', 'floater-bubble', 'floater-bubble', 'floater-paper'];
    const type = types[Math.floor(Math.random() * types.length)];

    const el = document.createElement('div');
    el.className = `floater ${type}`;
    el.style.left = (10 + Math.random() * 80) + '%';
    el.style.setProperty('--drift', (Math.random() * 40 - 20) + 'px');
    el.style.animationDuration = (6 + Math.random() * 8) + 's';

    sewerDecorations.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  },

  scheduleRat() {
    const spawn = () => {
      this.spawnRat();
      this.ratTimeout = setTimeout(spawn, 30000 + Math.random() * 60000);
    };
    this.ratTimeout = setTimeout(spawn, 15000 + Math.random() * 30000);
  },

  spawnRat() {
    if (!sewerDecorations) return;

    const rat = document.createElement('div');
    rat.className = 'pixel-rat';
    sewerDecorations.appendChild(rat);

    SoundEngine.playSqueak();
    rat.addEventListener('animationend', () => rat.remove());
  }
};

// ============================================================
// GRAFFITI WALL
// ============================================================

const graffitiWall = document.getElementById('graffiti-wall');
const graffitiCanvas = document.getElementById('graffiti-canvas');
const graffitiCtx = graffitiCanvas.getContext('2d');
const graffitiSubmitBtn = document.getElementById('graffiti-submit-btn');
const graffitiTextInput = document.getElementById('graffiti-text-input');
const graffitiClearBtn = document.getElementById('graffiti-clear');
let graffitiToken = localStorage.getItem('porcelain_graffiti_token');
let graffitiMode = 'draw';
let graffitiColor = '#1a1a1a';
let graffitiTextColor = '#1a1a1a';
let graffitiSize = 3;
let isDrawing = false;
let lastX = 0, lastY = 0;
let hasDrawn = false;

// Canvas drawing
graffitiCanvas.addEventListener('mousedown', (e) => {
  isDrawing = true;
  const rect = graffitiCanvas.getBoundingClientRect();
  lastX = (e.clientX - rect.left) * (graffitiCanvas.width / rect.width);
  lastY = (e.clientY - rect.top) * (graffitiCanvas.height / rect.height);
  hasDrawn = true;
});

graffitiCanvas.addEventListener('mousemove', (e) => {
  if (!isDrawing) return;
  const rect = graffitiCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (graffitiCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (graffitiCanvas.height / rect.height);

  graffitiCtx.strokeStyle = graffitiColor;
  graffitiCtx.lineWidth = graffitiSize;
  graffitiCtx.lineCap = 'round';
  graffitiCtx.lineJoin = 'round';
  graffitiCtx.beginPath();
  graffitiCtx.moveTo(lastX, lastY);
  graffitiCtx.lineTo(x, y);
  graffitiCtx.stroke();

  lastX = x;
  lastY = y;
});

graffitiCanvas.addEventListener('mouseup', () => isDrawing = false);
graffitiCanvas.addEventListener('mouseleave', () => isDrawing = false);

// Touch support
graffitiCanvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  isDrawing = true;
  const rect = graffitiCanvas.getBoundingClientRect();
  const touch = e.touches[0];
  lastX = (touch.clientX - rect.left) * (graffitiCanvas.width / rect.width);
  lastY = (touch.clientY - rect.top) * (graffitiCanvas.height / rect.height);
  hasDrawn = true;
});

graffitiCanvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!isDrawing) return;
  const rect = graffitiCanvas.getBoundingClientRect();
  const touch = e.touches[0];
  const x = (touch.clientX - rect.left) * (graffitiCanvas.width / rect.width);
  const y = (touch.clientY - rect.top) * (graffitiCanvas.height / rect.height);

  graffitiCtx.strokeStyle = graffitiColor;
  graffitiCtx.lineWidth = graffitiSize;
  graffitiCtx.lineCap = 'round';
  graffitiCtx.lineJoin = 'round';
  graffitiCtx.beginPath();
  graffitiCtx.moveTo(lastX, lastY);
  graffitiCtx.lineTo(x, y);
  graffitiCtx.stroke();

  lastX = x;
  lastY = y;
});

graffitiCanvas.addEventListener('touchend', () => isDrawing = false);

// Clear canvas
graffitiClearBtn.addEventListener('click', () => {
  graffitiCtx.clearRect(0, 0, graffitiCanvas.width, graffitiCanvas.height);
  hasDrawn = false;
});

// Tab switching
document.querySelectorAll('.graffiti-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.graffiti-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    graffitiMode = tab.dataset.tab;
    document.getElementById('graffiti-draw-panel').style.display = graffitiMode === 'draw' ? '' : 'none';
    document.getElementById('graffiti-text-panel').style.display = graffitiMode === 'text' ? '' : 'none';
  });
});

// Color selection (draw)
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    graffitiColor = btn.dataset.color;
  });
});

// Color selection (text)
document.querySelectorAll('.text-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.text-color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    graffitiTextColor = btn.dataset.color;
  });
});

// Size selection
document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    graffitiSize = parseInt(btn.dataset.size);
  });
});

// Submit graffiti
graffitiSubmitBtn.addEventListener('click', async () => {
  // Check if we have a valid token
  if (!graffitiToken) {
    await purchaseGraffiti();
    return;
  }

  // Verify token isn't expired
  try {
    const payload = JSON.parse(atob(graffitiToken.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      graffitiToken = null;
      localStorage.removeItem('porcelain_graffiti_token');
      await purchaseGraffiti();
      return;
    }
  } catch {
    graffitiToken = null;
    localStorage.removeItem('porcelain_graffiti_token');
    await purchaseGraffiti();
    return;
  }

  await submitGraffiti();
});

async function purchaseGraffiti() {
  graffitiSubmitBtn.disabled = true;
  graffitiSubmitBtn.textContent = 'REDIRECTING...';

  try {
    const res = await fetch('/api/graffiti-checkout', { method: 'POST' });
    const data = await res.json();

    if (data.devToken) {
      // Dev mode - free token
      graffitiToken = data.devToken;
      localStorage.setItem('porcelain_graffiti_token', graffitiToken);
      notify('Dev mode: free scribble granted!', 'success');
      await submitGraffiti();
      return;
    }

    if (data.url) {
      window.location.href = data.url;
    }
  } catch (err) {
    notify(err.message || 'Checkout failed', 'error');
  } finally {
    graffitiSubmitBtn.disabled = false;
    graffitiSubmitBtn.textContent = 'SCRIBBLE - $0.99';
  }
}

async function submitGraffiti() {
  let type, data, color;

  if (graffitiMode === 'draw') {
    if (!hasDrawn) {
      notify('Draw something first!', 'error');
      return;
    }
    type = 'draw';
    data = graffitiCanvas.toDataURL('image/png');
    color = graffitiColor;
  } else {
    const text = graffitiTextInput.value.trim();
    if (!text) {
      notify('Write something first!', 'error');
      return;
    }
    type = 'text';
    data = text;
    color = graffitiTextColor;
  }

  graffitiSubmitBtn.disabled = true;
  graffitiSubmitBtn.textContent = 'SCRIBBLING...';

  try {
    const res = await fetch('/api/graffiti', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: graffitiToken,
        type,
        data,
        color,
        x_pct: Math.random() * 70 + 15,
        y_pct: Math.random() * 50 + 10,
        rotation: Math.random() * 12 - 6,
        username: currentUsername || 'anon'
      })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    notify('Scribbled on the wall!', 'success');
    SoundEngine.playPlop();

    // Clear after submit
    if (graffitiMode === 'draw') {
      graffitiCtx.clearRect(0, 0, graffitiCanvas.width, graffitiCanvas.height);
      hasDrawn = false;
    } else {
      graffitiTextInput.value = '';
    }

    // Invalidate token (one scribble per purchase)
    graffitiToken = null;
    localStorage.removeItem('porcelain_graffiti_token');

    // Reload wall
    loadGraffitiWall();
  } catch (err) {
    notify(err.message, 'error');
    if (err.message.includes('expired') || err.message.includes('Invalid')) {
      graffitiToken = null;
      localStorage.removeItem('porcelain_graffiti_token');
    }
  } finally {
    graffitiSubmitBtn.disabled = false;
    graffitiSubmitBtn.textContent = 'SCRIBBLE - $0.99';
  }
}

// Load and display graffiti on the wall
async function loadGraffitiWall() {
  try {
    const res = await fetch('/api/graffiti');
    const items = await res.json();

    graffitiWall.innerHTML = '';

    for (const item of items) {
      const el = document.createElement('div');
      el.className = `graffiti-item ${item.type === 'draw' ? 'draw-graffiti' : 'text-graffiti'}`;
      el.style.left = item.x_pct + '%';
      el.style.top = item.y_pct + '%';
      el.style.transform = `rotate(${item.rotation}deg)`;

      if (item.type === 'draw') {
        const img = document.createElement('img');
        img.src = item.data;
        img.alt = 'graffiti';
        el.appendChild(img);
      } else {
        el.textContent = item.data;
        el.style.color = item.color;
      }

      graffitiWall.appendChild(el);
    }
  } catch { /* silent */ }
}

// Check for graffiti payment return
function checkGraffitiPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('graffiti_session_id');

  if (sessionId) {
    pollForGraffitiToken(sessionId);
    window.history.replaceState({}, '', '/');
  }
}

async function pollForGraffitiToken(sessionId, attempts = 0) {
  if (attempts > 30) {
    notify('Graffiti payment verification timed out.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/check-graffiti-payment?session_id=${sessionId}`);
    const data = await res.json();

    if (data.token) {
      graffitiToken = data.token;
      localStorage.setItem('porcelain_graffiti_token', graffitiToken);
      notify('Payment successful! Now draw or write your graffiti and hit SCRIBBLE.', 'success');
      return;
    }
  } catch { /* retry */ }

  setTimeout(() => pollForGraffitiToken(sessionId, attempts + 1), 1000);
}

// ============================================================
// MUTE TOGGLE
// ============================================================

function updateMuteUI() {
  muteBtn.textContent = isMuted ? '\u{1F507}' : '\u{1F50A}';
  muteBtn.classList.toggle('muted', isMuted);
}

muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  localStorage.setItem('porcelain_muted', isMuted);
  updateMuteUI();
});

// ============================================================
// NOTIFICATIONS
// ============================================================

function notify(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ============================================================
// POLLING
// ============================================================

function startPolling() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/stream');
      const data = await res.json();

      const existingIds = new Set(ideas.map(i => i.id));
      const newIdeas = data.filter(i => !existingIds.has(i.id));

      if (newIdeas.length > 0) {
        newIdeas.reverse().forEach(idea => addToStream(idea, true));
      }
    } catch { /* silent */ }
  }, 10000);

  // Stats polling
  setInterval(loadStats, 30000);
}

// ============================================================
// INIT
// ============================================================

// Init audio on first interaction
document.addEventListener('click', () => SoundEngine.init(), { once: true });
document.addEventListener('keydown', () => SoundEngine.init(), { once: true });

initUsername();
updateMuteUI();
checkPaymentReturn();
checkGraffitiPaymentReturn();
updateTokenUI();
loadStream();
loadStats();
loadGraffitiWall();
startPolling();
SewerAnimations.start();
