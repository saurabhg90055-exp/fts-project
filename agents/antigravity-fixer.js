/**
 * agents/antigravity-fixer.js — @antigravity-fixer
 *
 * Switch v0.40.1 SSE agent. Autonomous AI Code Repair Agent.
 * Listens for mentions of @antigravity-fixer in #fintech-war-room.
 * When triggered by @sql-forensics or the user, it automatically patches
 * payment-service/server.js with the idempotency fix and posts the diff to the room.
 *
 * Anti-spam: dedup set, self-ignore, isFixing lock, 30s cooldown.
 * SSE reconnect: exponential backoff (2s → 60s max), stops on fatal errors.
 */

require('dotenv').config();
const path        = require('path');
const EventSource = require('eventsource');
const { randomUUID } = require('crypto');
const fs          = require('fs');
const { execSync } = require('child_process');

const SWITCH_SERVER = process.env.SWITCH_URL || 'http://localhost:8080';
const ROOM_ID       = process.env.SWITCH_ROOM_ID;

// Support both FIXER_* and ANTIGRAVITY_* environment variable names
const REG_KEY       = process.env.FIXER_AGENT_TOKEN || process.env.ANTIGRAVITY_AGENT_TOKEN;
let   AGENT_ID      = process.env.FIXER_AGENT_ID || process.env.ANTIGRAVITY_AGENT_ID;
let   AGENT_API_KEY = process.env.FIXER_AGENT_API_KEY || process.env.ANTIGRAVITY_AGENT_API_KEY;

if (!ROOM_ID) { console.error('❌ Missing SWITCH_ROOM_ID'); process.exit(1); }
if (!AGENT_ID || !AGENT_API_KEY) {
  if (!REG_KEY) {
    console.error('❌ Missing FIXER_AGENT_ID + FIXER_AGENT_API_KEY, or FIXER_AGENT_TOKEN');
    console.error('   Add FIXER_AGENT_TOKEN to your .env from Switch Console → API Keys');
    process.exit(1);
  }
}

// ── Patching Logic ────────────────────────────────────────────────────────────
const SERVER_JS_PATH      = path.join(__dirname, '../payment-service/server.js');
const SERVER_PATCHED_PATH = path.join(__dirname, '../payment-service/server.patched.js');

const PATCHED_CODE = `const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, 'payments.db');
const db = new sqlite3.Database(dbPath);

// Initialize database schema with idempotency enforcement
db.serialize(() => {
  // Create transactions table
  db.run(\`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    card_last4 TEXT,
    amount INTEGER,
    idempotency_key TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )\`);

  // Migration: Deduplicate any existing duplicate rows before creating unique index
  // (Keeps the earliest record with the lowest id for each key)
  db.run(\`DELETE FROM transactions
          WHERE id NOT IN (
            SELECT MIN(id) FROM transactions GROUP BY idempotency_key
          )\`, (err) => {
    if (err) console.error('Deduplication migration error:', err.message);
  });

  // Enforce uniqueness at the database level on idempotency_key
  db.run(\`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key
          ON transactions (idempotency_key)\`, (err) => {
    if (err) console.error('Unique index creation error:', err.message);
  });

  // Seed single legitimate transaction if database is empty
  db.get('SELECT COUNT(*) as count FROM transactions', (err, row) => {
    if (row && row.count === 0) {
      db.run(
        \`INSERT OR IGNORE INTO transactions (user_email, card_last4, amount, idempotency_key, status)
         VALUES (?, ?, ?, ?, ?)\`,
        ['arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED']
      );
    }
  });
});

// PATCHED ENDPOINT: Enforces idempotency on payment charges
// Checks for existing idempotency_key before inserting:
// - Returns 200 + existing transaction if key was already processed (prevents double charges)
// - Returns 201 + new transaction if key is genuinely new
app.post('/api/v1/charge', (req, res) => {
  const { user_email, card_last4, amount, idempotency_key } = req.body;

  if (!idempotency_key) {
    return res.status(400).json({ error: 'idempotency_key is required' });
  }

  // Step 1: Check if this idempotency key was already processed
  db.get(
    \`SELECT id, status FROM transactions WHERE idempotency_key = ?\`,
    [idempotency_key],
    (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });

      if (existing) {
        // Return existing transaction — idempotent response
        return res.status(200).json({
          transaction_id: existing.id,
          status: existing.status,
          idempotent: true,
        });
      }

      // Step 2: Key is new — insert new transaction
      db.run(
        \`INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status)
         VALUES (?, ?, ?, ?, 'CAPTURED')\`,
        [user_email, card_last4, amount, idempotency_key],
        function (err) {
          if (err) {
            // Race condition fallback: concurrent request inserted first
            if (err.code === 'SQLITE_CONSTRAINT') {
              return db.get(
                \`SELECT id, status FROM transactions WHERE idempotency_key = ?\`,
                [idempotency_key],
                (err2, row) => {
                  if (err2 || !row) return res.status(500).json({ error: err.message });
                  return res.status(200).json({
                    transaction_id: row.id,
                    status: row.status,
                    idempotent: true,
                  });
                }
              );
            }
            return res.status(500).json({ error: err.message });
          }

          res.status(201).json({
            transaction_id: this.lastID,
            status: 'CAPTURED',
            idempotent: false,
          });
        }
      );
    }
  );
});

app.listen(4000, () => console.log('Payment API running on http://localhost:4000'));
`;

function applyServerPatch() {
  if (fs.existsSync(SERVER_PATCHED_PATH)) {
    fs.copyFileSync(SERVER_PATCHED_PATH, SERVER_JS_PATH);
  } else {
    fs.writeFileSync(SERVER_JS_PATH, PATCHED_CODE, 'utf8');
  }

  // Verify syntax
  execSync(`node --check "${SERVER_JS_PATH}"`);
  console.log('[antigravity-fixer] ✅ Successfully patched payment-service/server.js');
}

// ── Post message ──────────────────────────────────────────────────────────────
const CONNECTION_ID = randomUUID();

async function postMessage(content, roomId) {
  const targetRoom = roomId || ROOM_ID;

  try {
    const res = await fetch(`${SWITCH_SERVER}/agents/${AGENT_ID}/ops/post_message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENT_API_KEY}`,
        'X-Switch-Connection-Id': CONNECTION_ID,
      },
      body: JSON.stringify({ room_id: targetRoom, content }),
    });
    if (res.ok) { console.log('[antigravity-fixer] ✉️  Message posted via ops.'); return; }
    console.warn(`[antigravity-fixer] ⚠️ ops/post_message ${res.status}, trying fallback...`);
  } catch (err) {
    console.warn('[antigravity-fixer] ⚠️ ops error:', err.message);
  }

  try {
    const res = await fetch(`${SWITCH_SERVER}/agents/${AGENT_ID}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AGENT_API_KEY}` },
      body: JSON.stringify({ room_id: targetRoom, content }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('[antigravity-fixer] ✉️  Message posted to room.');
  } catch (err) {
    console.error('[antigravity-fixer] ❌ postMessage failed:', err.message);
  }
}

// ── Register Agent ────────────────────────────────────────────────────────────
async function registerAgent() {
  console.log('[antigravity-fixer] 🔧 Registering agent with Switch...');
  const body = {
    name: 'antigravity-fixer',
    description: 'Autonomous AI code repair agent — patches payment-service/server.js to enforce idempotency',
    connector_type: 'custom',
    integration_profile: { connection_model: 'always_on', message_exchange: true,
      pre_invocation_mediation: [], post_invocation_mediation: [], event_reporting: [] },
  };
  let res = await fetch(`${SWITCH_SERVER}/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${REG_KEY}` },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    res = await fetch(`${SWITCH_SERVER}/agents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${REG_KEY}` },
      body: JSON.stringify({ ...body, overwrite: true }),
    });
  }
  if (!res.ok) throw new Error(`Registration failed: HTTP ${res.status}`);
  const data = await res.json();
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, 'utf8');
    env = env.replace(/^FIXER_AGENT_ID=.*$/m, `FIXER_AGENT_ID=${data.id}`)
             .replace(/^FIXER_AGENT_API_KEY=.*$/m, `FIXER_AGENT_API_KEY=${data.api_key}`);
    if (!env.includes('FIXER_AGENT_ID='))     env += `\nFIXER_AGENT_ID=${data.id}`;
    if (!env.includes('FIXER_AGENT_API_KEY=')) env += `\nFIXER_AGENT_API_KEY=${data.api_key}`;
    fs.writeFileSync(envPath, env);
    console.log('[antigravity-fixer] ✅ Registered + .env updated. Restart the agent.\n');
  }
  process.exit(0);
}

// ── Anti-spam state ───────────────────────────────────────────────────────────
const OWN_SIGNATURES = [
  'Antigravity Fixer:',
  'Hotfix applied to `payment-service/server.js`',
  'Patch Details:',
];

let isFixing      = false;
let lastFixAt     = 0;
const COOLDOWN_MS = 20_000;
const MAX_SEEN    = 500;
let reconnectDelay = 2000;

// ── SSE Connection ────────────────────────────────────────────────────────────
function connectSSE() {
  const sseUrl = `${SWITCH_SERVER}/agents/${AGENT_ID}/events`
    + `?connection_id=${CONNECTION_ID}`
    + `&scope=all&filter=all&start_from=head`;
  console.log(`[antigravity-fixer] 🔌 Connecting to SSE...`);

  const es = new EventSource(sseUrl, {
    headers: { Authorization: `Bearer ${AGENT_API_KEY}` },
  });

  let cursor = 0;
  let heartbeatTimer = null;
  const processed = new Set();
  let isInitialConnect = true;

  function cleanup() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    try { es.close(); } catch {}
  }

  function scheduleReconnect(reason) {
    cleanup();
    console.log(`[antigravity-fixer] 🔄 Reconnecting in ${reconnectDelay / 1000}s... (${reason})`);
    setTimeout(connectSSE, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  }

  es.onopen = () => {
    if (isInitialConnect) {
      console.log('[antigravity-fixer] ✅ Connected to Switch Room SSE stream.');
      console.log('[antigravity-fixer] 🚀 Waiting for @antigravity-fixer mention in #fintech-war-room …');
      isInitialConnect = false;
    }
    reconnectDelay = 2000;

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(async () => {
      try {
        const r = await fetch(`${SWITCH_SERVER}/agents/${AGENT_ID}/connection/beat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AGENT_API_KEY}` },
          body: JSON.stringify({ connection_id: CONNECTION_ID, cursor }),
        });
        if (r.status === 404) {
          scheduleReconnect('heartbeat 404');
        } else if (r.status === 409) {
          try {
            const body = await r.json();
            if (body.code === 'taken_over') {
              console.error('[antigravity-fixer] ❌ Connection taken over. Stopping.');
              cleanup();
              return;
            }
          } catch {}
          scheduleReconnect('heartbeat 409');
        }
      } catch { /* network hiccup */ }
    }, 2000);
  };

  es.addEventListener('message', async (event) => {
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }

    if (typeof frame.id === 'number') cursor = frame.id;

    const data    = frame.data || {};
    const payload = data.payload || frame.payload;
    if (!payload) return;

    const content = payload.body || payload.content || '';
    if (!content) return;

    // Guard 1: Dedup
    const dedupKey = `${frame.id}:${content.slice(0, 100)}`;
    if (processed.has(dedupKey)) return;
    processed.add(dedupKey);
    if (processed.size > MAX_SEEN) {
      const first = processed.values().next().value;
      processed.delete(first);
    }

    // Guard 2: Ignore self by sender_name
    const senderName = (payload.sender_name || data.sender_name || '').toLowerCase();
    if (senderName === 'antigravity-fixer') return;

    // Guard 3: Content echo filter
    if (OWN_SIGNATURES.some(sig => content.includes(sig))) return;

    // Guard 4: Check if triggered by @antigravity-fixer mention
    const contentLower = content.toLowerCase();
    const isTriggered = contentLower.includes('@antigravity-fixer') ||
      (contentLower.includes('antigravity-fixer') && (contentLower.includes('patch') || contentLower.includes('fix')));

    if (!isTriggered) return;

    // Guard 5: Busy lock
    if (isFixing) {
      console.log('[antigravity-fixer] ⏳ Patching in progress — skipping duplicate trigger.');
      return;
    }

    // Guard 6: Cooldown
    const now = Date.now();
    if ((now - lastFixAt) < COOLDOWN_MS) {
      console.log('[antigravity-fixer] ⏳ Cooldown active — skipping.');
      return;
    }

    isFixing = true;
    lastFixAt = now;
    const eventRoomId = data.room_id || ROOM_ID;
    console.log('[antigravity-fixer] 🔔 Mention detected — applying hotfix to payment-service/server.js…');

    try {
      applyServerPatch();

      const patchMessage = [
        `🛠️ **Antigravity Fixer:** Hotfix applied to \`payment-service/server.js\`!`,
        ``,
        `**Patch Summary:**`,
        `• Added idempotency pre-lookup in \`POST /api/v1/charge\` (\`SELECT id, status ...\`)`,
        `• Automatically deduplicates existing incident records on startup`,
        `• Added UNIQUE constraint & index on \`transactions(idempotency_key)\``,
        `• Added concurrent race-condition handling (\`SQLITE_CONSTRAINT\`)`,
        ``,
        `\`\`\`diff`,
        `--- a/payment-service/server.js`,
        `+++ b/payment-service/server.js`,
        `@@ -41,17 +52,38 @@`,
        `- db.run("INSERT INTO transactions ...")`,
        `+ db.get("SELECT id, status FROM transactions WHERE idempotency_key = ?", ...)`,
        `+ // Returns 200 on existing transaction, 201 only if genuinely new`,
        `\`\`\``,
        ``,
        `👉 **Next Step:**`,
        `1. Restart the payment API (\`Ctrl+C\` then \`npm run start:api\` in Terminal 1)`,
        `2. Tag **release-gatekeeper** to run CI verification!`,
      ].join('\n');

      await postMessage(patchMessage, eventRoomId);
    } catch (err) {
      await postMessage(
        `⚠️ **Antigravity Fixer** error while patching: \`${err.message}\``,
        eventRoomId
      );
    } finally {
      isFixing = false;
    }
  });

  es.onerror = (err) => {
    const status = err.status;
    if (typeof status === 'number' && [400, 401, 403].includes(status)) {
      console.error(`[antigravity-fixer] ❌ Fatal SSE error (${status}). Check SWITCH_URL and agent credentials.`);
      cleanup();
      return;
    }
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!AGENT_ID || !AGENT_API_KEY) await registerAgent();
  connectSSE();
}
main().catch(err => { console.error('[antigravity-fixer] Fatal:', err.message); process.exit(1); });

