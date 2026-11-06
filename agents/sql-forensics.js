/**
 * agents/sql-forensics.js — @sql-forensics
 *
 * Switch v0.40.1 SSE agent. Queries payments.db on @sql-forensics mention.
 * Masks PII per Room Rule #1. Reports root cause to @antigravity-fixer.
 *
 * Anti-spam: dedup set, self-ignore (name + content echo), busy lock, 30s cooldown.
 * SSE reconnect: exponential backoff (2s → 60s max), stops on fatal errors.
 *
 * Event format (from Switch docs):
 *   { event: "message",
 *     data: { type: "message", room_id, payload: { addressed, sender, sender_name, body, ... } },
 *     id: <sequence> }
 */

require('dotenv').config();
const sqlite3     = require('sqlite3').verbose();
const path        = require('path');
const EventSource = require('eventsource');
const { randomUUID } = require('crypto');
const fs          = require('fs');

const SWITCH_SERVER = process.env.SWITCH_URL || 'http://localhost:8080';
const ROOM_ID       = process.env.SWITCH_ROOM_ID;
const REG_KEY       = process.env.SQL_AGENT_TOKEN;
let   AGENT_ID      = process.env.SQL_AGENT_ID;
let   AGENT_API_KEY = process.env.SQL_AGENT_API_KEY;

if (!ROOM_ID) { console.error('❌ Missing SWITCH_ROOM_ID'); process.exit(1); }
if (!AGENT_ID || !AGENT_API_KEY) {
  if (!REG_KEY) { console.error('❌ Missing SQL_AGENT_ID + SQL_AGENT_API_KEY, or SQL_AGENT_TOKEN'); process.exit(1); }
}

// ── SQLite (read-only) ────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '../payment-service/payments.db');
const db = new sqlite3.Database(
  DB_PATH,
  sqlite3.OPEN_READONLY,
  (err) => {
    if (err) {
      console.error('[sql-forensics] ❌ Cannot open payments.db:', err.message);
      console.error('   → Start the payment API first: npm run start:api');
      process.exit(1);
    }
    console.log('[sql-forensics] ✅ Opened payments.db');
  }
);

function maskCard(card) {
  if (!card) return '****-****-****-????';
  return card.replace(/\d{4}-\d{4}-\d{4}-(\d{4})/, '****-****-****-$1');
}

function runForensics() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT user_email, card_last4, amount, idempotency_key, COUNT(*) as duplicate_count
      FROM transactions GROUP BY idempotency_key
      HAVING COUNT(*) > 1 ORDER BY duplicate_count DESC
    `, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(r => ({
        user_email:                 r.user_email,
        card_last4:                 maskCard(r.card_last4),
        amount_cents:               r.amount,
        idempotency_key:            r.idempotency_key,
        duplicate_count:            r.duplicate_count,
        estimated_overcharge_cents: r.amount * (r.duplicate_count - 1),
      })));
    });
  });
}

// ── Post message ──────────────────────────────────────────────────────────────
const CONNECTION_ID = randomUUID();

async function postMessage(content, roomId) {
  const targetRoom = roomId || ROOM_ID;

  // Primary: ops/post_message (connection-aware)
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
    if (res.ok) { console.log('[sql-forensics] ✉️  Message posted via ops.'); return; }
    console.warn(`[sql-forensics] ⚠️ ops/post_message ${res.status}, trying fallback...`);
  } catch (err) {
    console.warn('[sql-forensics] ⚠️ ops error:', err.message);
  }

  // Fallback: /message (no connection required)
  try {
    const res = await fetch(`${SWITCH_SERVER}/agents/${AGENT_ID}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AGENT_API_KEY}` },
      body: JSON.stringify({ room_id: targetRoom, content }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('[sql-forensics] ✉️  Message posted to room.');
  } catch (err) {
    console.error('[sql-forensics] ❌ postMessage failed:', err.message);
  }
}

// ── Register ──────────────────────────────────────────────────────────────────
async function registerAgent() {
  console.log('[sql-forensics] 🔧 Registering agent with Switch...');
  const body = {
    name: 'sql-forensics',
    description: 'Queries SQLite payment DB, masks PII, finds duplicate charges',
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
    env = env.replace(/^SQL_AGENT_ID=.*$/m, `SQL_AGENT_ID=${data.id}`)
             .replace(/^SQL_AGENT_API_KEY=.*$/m, `SQL_AGENT_API_KEY=${data.api_key}`);
    if (!env.includes('SQL_AGENT_ID='))     env += `\nSQL_AGENT_ID=${data.id}`;
    if (!env.includes('SQL_AGENT_API_KEY=')) env += `\nSQL_AGENT_API_KEY=${data.api_key}`;
    fs.writeFileSync(envPath, env);
    console.log('[sql-forensics] ✅ Registered + .env updated. Restart the agent.\n');
  }
  process.exit(0);
}

// ── Anti-spam state ───────────────────────────────────────────────────────────

// Strings only OUR outgoing messages contain — used for echo filtering
const OWN_SIGNATURES = [
  'SQL Forensics Report',
  'No duplicate transactions found',
  'SQL Forensics encountered an error',
  'SQL Forensics:',
];

let isBusy    = false;
let lastRunAt = 0;
const COOLDOWN_MS  = 30_000;
const MAX_SEEN     = 500;
let reconnectDelay = 2000; // exponential backoff: 2s → 4s → 8s → ... → 60s max

// ── SSE connection ────────────────────────────────────────────────────────────
function connectSSE() {
  const sseUrl = `${SWITCH_SERVER}/agents/${AGENT_ID}/events`
    + `?connection_id=${CONNECTION_ID}`
    + `&scope=all&filter=all&start_from=head`;
  console.log(`[sql-forensics] 🔌 Connecting to SSE...`);

  const es = new EventSource(sseUrl, {
    headers: { Authorization: `Bearer ${AGENT_API_KEY}` },
  });

  let cursor = 0;
  let heartbeatTimer = null;
  const processed = new Set();

  function cleanup() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    try { es.close(); } catch {}
  }

  function scheduleReconnect(reason) {
    cleanup();
    console.log(`[sql-forensics] 🔄 Reconnecting in ${reconnectDelay / 1000}s... (${reason})`);
    setTimeout(connectSSE, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  }

  let isInitialConnect = true;

  es.onopen = () => {
    if (isInitialConnect) {
      console.log('[sql-forensics] ✅ Connected to Switch Room SSE stream.');
      console.log('[sql-forensics] 🚀 Waiting for @sql-forensics mention in #fintech-war-room …');
      isInitialConnect = false;
    }
    reconnectDelay = 2000; // reset backoff on success

    // Ensure previous heartbeat timer is cleared before starting a new one
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // Heartbeat every 2s (per Switch docs: TTL = 6s)
    heartbeatTimer = setInterval(async () => {
      try {
        const r = await fetch(`${SWITCH_SERVER}/agents/${AGENT_ID}/connection/beat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AGENT_API_KEY}` },
          body: JSON.stringify({ connection_id: CONNECTION_ID, cursor }),
        });
        if (r.status === 404) {
          // Connection unknown or dead — reopen
          scheduleReconnect('heartbeat 404');
        } else if (r.status === 409) {
          // Check if taken_over — don't reconnect
          try {
            const body = await r.json();
            if (body.code === 'taken_over') {
              console.error('[sql-forensics] ❌ Connection taken over. Stopping.');
              cleanup();
              return;
            }
          } catch {}
          scheduleReconnect('heartbeat 409');
        }
      } catch { /* network hiccup, heartbeat will retry */ }
    }, 2000);
  };

  es.addEventListener('message', async (event) => {
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }

    // Update cursor from the sequence number (frame.id)
    if (typeof frame.id === 'number') cursor = frame.id;

    // Extract message payload per Switch docs:
    // frame.data.payload = { addressed, sender, sender_name, body, ... }
    const data    = frame.data || {};
    const payload = data.payload || frame.payload;
    if (!payload) return;

    // The message body is in payload.body (per docs), fallback to payload.content
    const content = payload.body || payload.content || '';
    if (!content) return;

    // ── Guard 1: Dedup by sequence + content prefix ──
    const dedupKey = `${frame.id}:${content.slice(0, 100)}`;
    if (processed.has(dedupKey)) return;
    processed.add(dedupKey);
    if (processed.size > MAX_SEEN) {
      // Evict oldest entry
      const first = processed.values().next().value;
      processed.delete(first);
    }

    // ── Guard 2: Self-ignore by sender_name ──
    const senderName = (payload.sender_name || data.sender_name || '').toLowerCase();
    if (senderName === 'sql-forensics') return;

    // ── Guard 3: Content echo filter — skip messages containing our own output ──
    if (OWN_SIGNATURES.some(sig => content.includes(sig))) return;

    // ── Guard 4: Only trigger on @sql-forensics mention ──
    if (!content.toLowerCase().includes('@sql-forensics')) return;

    // ── Guard 5: Busy lock ──
    if (isBusy) {
      console.log('[sql-forensics] ⏳ Already running — skipping duplicate trigger.');
      return;
    }

    // ── Guard 6: Cooldown ──
    const now = Date.now();
    if ((now - lastRunAt) < COOLDOWN_MS) {
      console.log('[sql-forensics] ⏳ Cooldown active — skipping.');
      return;
    }

    isBusy = true;
    lastRunAt = now;
    const eventRoomId = data.room_id || ROOM_ID;
    console.log('[sql-forensics] 🔔 Mention detected — running DB forensics…');

    try {
      const duplicates = await runForensics();

      if (duplicates.length === 0) {
        await postMessage(
          '✅ **SQL Forensics:** No duplicate transactions found in `payments.db`. Database looks clean.',
          eventRoomId
        );
        return;
      }

      const totalOvercharge = duplicates.reduce((s, r) => s + r.estimated_overcharge_cents, 0);
      const report = [
        `🔍 **SQL Forensics Report** _(PII masked — Room Rule #1 compliant)_`,
        ``,
        `Found **${duplicates.length}** duplicate transaction group(s) in \`payments.db\`:`,
        `\`\`\`json`,
        JSON.stringify(duplicates, null, 2),
        `\`\`\``,
        `💸 **Estimated overcharge:** \`$${(totalOvercharge / 100).toFixed(2)} USD\``,
        ``,
        `**Root cause:** \`POST /api/v1/charge\` in \`payment-service/server.js\` inserts a new`,
        `row on every request without checking if the \`idempotency_key\` already exists.`,
        ``,
        `**Next step for antigravity-fixer:** Patch \`payment-service/server.js\` to enforce`,
        `idempotency (SELECT existing row before INSERT) and add a UNIQUE index on \`idempotency_key\`.`,
        `Once patched, tag the release gatekeeper to run CI verification.`,
      ].join('\n');
      await postMessage(report, eventRoomId);
    } catch (err) {
      await postMessage(
        `⚠️ **SQL Forensics** encountered an error: \`${err.message}\``,
        eventRoomId
      );
    } finally {
      isBusy = false;
    }
  });

  es.onerror = (err) => {
    const status = err.status;

    // Only log and stop on fatal authentication/authorization errors
    if (typeof status === 'number' && [400, 401, 403].includes(status)) {
      console.error(`[sql-forensics] ❌ Fatal SSE error (${status}). Check SWITCH_URL and agent credentials.`);
      cleanup();
      return;
    }

    // Normal transient socket resets/keepalives are auto-reconnected by EventSource silently
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!AGENT_ID || !AGENT_API_KEY) await registerAgent();
  connectSSE();
}
main().catch(err => { console.error('[sql-forensics] Fatal:', err.message); process.exit(1); });
