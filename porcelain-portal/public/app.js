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

// === State ===
let decryptToken = localStorage.getItem('porcelain_token');
let ideas = [];

// === Character Counter ===
ideaInput.addEventListener('input', () => {
  const len = ideaInput.value.length;
  charCount.textContent = len;
  const counter = charCount.parentElement;
  counter.classList.remove('warning', 'danger');
  if (len > 120) counter.classList.add('danger');
  else if (len > 100) counter.classList.add('warning');
});

// === Flush ===
flushBtn.addEventListener('click', flushIdea);

ideaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    flushIdea();
  }
});

async function flushIdea() {
  const idea = ideaInput.value.trim();
  if (!idea) return;
  if (idea.length > 140) {
    notify('Too long! 140 chars max.', 'error');
    return;
  }

  flushBtn.disabled = true;
  flushBtn.textContent = 'FLUSHING...';

  try {
    const res = await fetch('/api/flush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Flush failed');

    // Trigger flush animation
    toilet.classList.add('flushing');
    water.classList.add('swirl');

    setTimeout(() => {
      toilet.classList.remove('flushing');
      water.classList.remove('swirl');
    }, 1000);

    // Clear input
    ideaInput.value = '';
    charCount.textContent = '0';
    charCount.parentElement.classList.remove('warning', 'danger');

    // Add to stream
    addToStream({
      id: data.id,
      ciphertext: data.ciphertext,
      created_at: data.created_at
    }, true);

    flushBtn.textContent = 'FLUSHED!';
    flushBtn.classList.add('flushed');
    setTimeout(() => {
      flushBtn.textContent = 'FLUSH IT';
      flushBtn.classList.remove('flushed');
    }, 1500);

  } catch (err) {
    notify(err.message, 'error');
    flushBtn.textContent = 'FLUSH IT';
  } finally {
    flushBtn.disabled = false;
  }
}

// === Stream ===
async function loadStream() {
  try {
    const res = await fetch('/api/stream');
    const data = await res.json();
    ideas = data;
    renderStream();
  } catch (err) {
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

  const temp = document.createElement('div');
  temp.innerHTML = createEntryHTML(idea);
  const entry = temp.firstElementChild;
  if (isNew) entry.classList.add('new-entry');

  streamList.prepend(entry);
  updateDecryptableState();

  // Remove oldest if over 100
  while (streamList.children.length > 102) { // +2 for fade elements
    streamList.removeChild(streamList.lastChild);
  }

  streamCount.textContent = `${ideas.length} idea${ideas.length !== 1 ? 's' : ''} flushed into the void`;
}

function formatCipher(hex) {
  // Show garbled text - mix of hex and special chars for visual effect
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
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

// === Payment ===
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
    payBtn.textContent = 'UNLOCK 20 IDEAS - $1.99';
  }
});

// Check for returning from Stripe
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
  } catch (err) {
    // retry
  }

  setTimeout(() => pollForToken(sessionId, attempts + 1), 1000);
}

function updateTokenUI() {
  if (!decryptToken) {
    tokenInfo.style.display = 'none';
    payBtn.style.display = '';
    return;
  }

  try {
    // Decode JWT payload (not verify - that's server-side)
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

    // Check if token is expired
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
  if (!decryptToken) return;
  if (entry.classList.contains('decrypted')) return;

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

    // Update token
    decryptToken = data.token;
    localStorage.setItem('porcelain_token', data.token);
    updateTokenUI();

    // Reveal the idea
    if (data.ideas && data.ideas.length > 0) {
      const cipher = entry.querySelector('.entry-cipher');
      cipher.textContent = data.ideas[0].idea;
      entry.classList.remove('decryptable');
      entry.classList.add('decrypted');
      entry.onclick = null;
    }
  } catch (err) {
    notify(err.message, 'error');
  }
}

// === Notifications ===
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

// === Polling ===
function startPolling() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/stream');
      const data = await res.json();

      // Find new ideas
      const existingIds = new Set(ideas.map(i => i.id));
      const newIdeas = data.filter(i => !existingIds.has(i.id));

      if (newIdeas.length > 0) {
        // Add new ones to the top
        newIdeas.reverse().forEach(idea => addToStream(idea, true));
      }
    } catch {
      // silent fail on poll
    }
  }, 10000);
}

// === Init ===
checkPaymentReturn();
updateTokenUI();
loadStream();
startPolling();
