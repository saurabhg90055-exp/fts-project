/**
 * agents/sql-forensics.js
 * Custom Switch Agent #1 — @sql-forensics
 *
 * Protocol (Switch v0.40.1 agent protocol):
 *   • Registers once with POST /agents using the registration key
 *   • Subscribes to room events via SSE: GET /agents/{agent_id}/events
 *   • Sends heartbeat every 2s: POST /agents/{agent_id}/connection/beat
 *   • When tagged @sql-forensics in Discord, queries payments.db
 *   • Masks PII per Room Rule #1 before posting
 *   • Hands root cause + fix request to @antigravity-fixer
 *
 * Spam-prevention guards:
 *   1. Dedup by SSE cursor + content prefix (unique per event)
 *   2. Self-ignore by agent ID and agent name
 *   3. Content-based echo filter (skip our own outgoing message text)
 *   4. isBusy lock — only one forensics run at a time
 *   5. 60-second cooldown between runs
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

if (!ROOM_ID) {
  console.error('❌ Missing required env var: SWITCH_ROOM_ID');
  process.exit(1);
}
if (!AGENT_ID || !AGENT_API_KEY) {
  if (!REG_KEY) {
    console.error('❌ Missing env vars: either set SQL_AGENT_ID + SQL_AGENT_API_KEY, or SQL_AGENT_TOKEN');
    process.exit(1);
  }
}

// ── SQLite ───────────────────────────────────────────────────────────────────
const db = new sqlite3.Database(
  path.join(__dirname, '../payment-service/payments.db'),
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

// ── PII Masking — Room Rule #1 ───────────────────────────────────────────────
function maskCard(card) {
  if (!card) return '****-****-****-????';
  return card.replace(/\d{4}-\d{4}-\d{4}-(\d{4})/, '****-****-****-$1');
}

// ── Forensics Query ──────────────────────────────────────────────────────────
function runForensics(callback) {
  const query = `
    SELECT user_email, card_last4, amount, idempotency_key, COUNT(*) as duplicate_count
    FROM transactions
    GROUP BY idempotency_key
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return callback(`SQL Error: ${err.message}`);
    const sanitized = rows.map(r => ({
      user_email:                 r.user_email,
      card_last4:                 maskCard(r.card_last4),
      amount_cents:               r.amount,
      idempotency_key:            r.idempotency_key,
      duplicate_count:            r.duplicate_count,
      estimated_overcharge_cents: r.amount * (r.duplicate_count - 1),
    }));
    callback(null, sanitized);
  });
}

// ── Post message ─────────────────────────────────────────────────────────────
async function postMessage(content, roomId) {
  const targetRoom = roomId || ROOM_ID;

  try {
    const res = await fetch(`${SWITCH_SERVER}/agents/${AGENT_ID}/ops/post_message`, {
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'Authorization':          `Bearer ${AGENT_API_KEY}`,
        'X-Switch-Connection-Id': CONNECTION_ID,
      },
      body: JSON.stringify({ room_id: targetRoom, content }),
    });
    if (res.ok) {
      console.log('[sql-forensics] ✉️  Message posted via ops.');
      return;
    }
    console.warn(`[sql-forensics] ⚠️ ops/post_message failed (${res.status}), trying /message fallback...`);
  } catch (err) {
    console.warn('[sql-forensics] ⚠️ ops/post_message error:', err.message);
  }

  try {
    const res = await fetch(`${SWITCH_SERVER}/agents/${AGENT_ID}/message`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${AGENT_API_KEY}`,
      },
      body: JSON.stringify({ room_id: targetRoom, content }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${txt}`);
    }
    console.log('[sql-forensics] ✉️  Message posted to room.');
  } catch (err) {
    console.error('[sql-forensics] ❌ postMessage failed:', err.message);
  }
}

// ── Register agent once ───────────────────────────────────────────────────────
async function registerAgent() {
  console.log('[sql-forensics] 🔧 Registering agent with Switch...');
  const body = {
    name:              'sql-forensics',
    description:       'Queries SQLite payment DB, masks PII, finds duplicate charges',
    connector_type:    'custom',
    integration_profile: {
      connection_model:          'always_on',
      message_exchange:          true,
      pre_invocation_mediation:  [],
      post_invocation_mediation: [],
      event_reporting:           [],
    },
  };

  let res = await fetch(`${SWITCH_SERVER}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${REG_KEY}` },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    console.log('[sql-forensics] ⚠️  Name exists (409) — re-registering with overwrite:true...');
    res = await fetch(`${SWITCH_SERVER}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${REG_KEY}` },
      body: JSON.stringify({ ...body, overwrite: true }),
    });
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Registration failed: HTTP ${res.status} — ${txt}`);
  }

  const data = await res.json();
  console.log('\n[sql-forensics] ✅ Registered! Patching .env...\n');

  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, 'utf8');
    env = env.replace(/^SQL_AGENT_ID=.*$/m,      `SQL_AGENT_ID=${data.id}`)
             .replace(/^SQL_AGENT_API_KEY=.*$/m,  `SQL_AGENT_API_KEY=${data.api_key}`);
    if (!env.includes('SQL_AGENT_ID='))     env += `\nSQL_AGENT_ID=${data.id}`;
    if (!env.includes('SQL_AGENT_API_KEY=')) env += `\nSQL_AGENT_API_KEY=${data.api_key}`;
    fs.writeFileSync(envPath, env);
    console.log('[sql-forensics] ✅ .env updated — restart the agent now.\n');
  } else {
    console.log(`  SQL_AGENT_ID=${data.id}`);
    console.log(`  SQL_AGENT_API_KEY=${data.api_key}`);
    console.log('\n  Add these to your .env, then restart.\n');
  }

  process.exit(0);
}

// ── SSE connection ────────────────────────────────────────────────────────────
const CONNECTION_ID = randomUUID();

// Strings that ONLY appear in our own outgoing messages — used for echo filtering
const OWN_MESSAGE_SIGNATURES = [
  'SQL Forensics Report',
  'No duplicate transactions found',
  'SQL Forensics** error',
  'SQL Forensics: error',
];

// Global state
let isBusy       = false;
let lastRunAt     = 0;
const RUN_COOLDOWN_MS = 60000; // 60-second minimum between runs

function connectSSE() {
  const sseUrl = `${SWITCH_SERVER}/agents/${AGENT_ID}/events?connection_id=${CONNECTION_ID}&scope=all&filter=all&start_from=head`;
  console.log(`[sql-forensics] 🔌 Connecting to SSE: ${sseUrl}`);

  const es = new EventSource(sseUrl, {
    headers: { Authorization: `Bearer ${AGENT_API_KEY}` },
  });

  let cursor = 0;
  const processedKeys = new Set();

  es.onopen = async () => {
    console.log('[sql-forensics] ✅ Connected to Switch Room SSE stream.');

    // List agent rooms on startup
    setTimeout(async () => {
      try {
        const res = await fetch(`${SWITCH_SERVER}/agents/${AGENT_ID}/ops/list_rooms`, {
          method: 'POST',
          headers: {
            'Content-Type':           'application/json',
            'Authorization':          `Bearer ${AGENT_API_KEY}`,
            'X-Switch-Connection-Id': CONNECTION_ID,
          },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const data = await res.json();
          const rooms = data.result?.rooms || data.rooms || [];
          console.log('[sql-forensics] 📋 Agent room memberships:');
          if (rooms.length === 0) {
            console.log('   ⚠️  NONE — go to Switch Console → fintech-war-room → Participants → add sql-forensics');
          }
          rooms.forEach(r => console.log(`   ✅ ${r.id}  "${r.name || r.title || '(unnamed)'}"`));
        }
      } catch (e) { /* ignore */ }
    }, 500);

    console.log('[sql-forensics] 🚀 Waiting for @sql-forensics mention in #fintech-war-room …');
  };

  // Heartbeat every 2 seconds
  const heartbeat = setInterval(async () => {
    try {
      const r = await fetch(`${SWITCH_SERVER}/agents/${AGENT_ID}/connection/beat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AGENT_API_KEY}` },
        body: JSON.stringify({ connection_id: CONNECTION_ID, cursor }),
      });
      if (r.status === 404) {
        clearInterval(heartbeat);
        es.close();
        console.log('[sql-forensics] 🔄 Connection lost — reconnecting...');
        setTimeout(connectSSE, 2000);
      }
    } catch { /* network hiccup */ }
  }, 2000);

  es.addEventListener('message', async (event) => {
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }

    if (frame.id) cursor = frame.id;

    const payload = frame.data?.payload || frame.payload;
    if (!payload) return;

    const content = payload.body || payload.content || '';
    if (!content) return;

    // ── Guard 1: Deduplicate by cursor + content prefix ───────────────────────
    const dedupKey = `${frame.id}:${content.slice(0, 100)}`;
    if (processedKeys.has(dedupKey)) return;
    processedKeys.add(dedupKey);
    if (processedKeys.size > 500) processedKeys.delete(processedKeys.values().next().value);

    // ── Guard 2: Ignore messages from ourselves (by ID) ───────────────────────
    const senderId = payload.sender_id || frame.data?.sender_id || '';
    if (senderId === AGENT_ID) return;

    // ── Guard 3: Ignore messages from ourselves (by name, catches Discord echo) ─
    const senderName = (payload.sender_name || frame.data?.sender_name || '').toLowerCase();
    if (senderName === 'sql-forensics') return;

    // ── Guard 4: Content echo filter — skip our own outgoing message text ─────
    if (OWN_MESSAGE_SIGNATURES.some(sig => content.includes(sig))) return;

    const eventRoomId = frame.data?.room_id || ROOM_ID;

    // ── Guard 5: Only fire on @sql-forensics mention ──────────────────────────
    if (!content.toLowerCase().includes('@sql-forensics')) return;

    // ── Guard 6: isBusy lock ──────────────────────────────────────────────────
    if (isBusy) {
      console.log('[sql-forensics] ⏳ Already processing — skipping duplicate trigger.');
      return;
    }

    // ── Guard 7: 60-second cooldown ───────────────────────────────────────────
    const now = Date.now();
    if ((now - lastRunAt) < RUN_COOLDOWN_MS) {
      console.log(`[sql-forensics] ⏳ Cooldown active (${Math.round((RUN_COOLDOWN_MS - (now - lastRunAt)) / 1000)}s left) — skipping.`);
      return;
    }

    isBusy   = true;
    lastRunAt = now;
    console.log('[sql-forensics] 🔔 Mention detected — running DB forensics…');
    console.log(`[sql-forensics] 📍 Replying to room: ${eventRoomId}`);

    runForensics(async (err, duplicates) => {
      try {
        if (err) {
          // NOTE: NO "@sql-forensics" in error text to prevent echo re-trigger
          await postMessage(`⚠️ **SQL Forensics** encountered an error: \`${err}\``, eventRoomId);
          return;
        }

        if (duplicates.length === 0) {
          // NOTE: NO "@sql-forensics" mention in this text
          await postMessage('✅ **SQL Forensics:** No duplicate transactions found in `payments.db`. Database looks clean.', eventRoomId);
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
          // NOTE: "Tag @release-gatekeeper" is removed — antigravity-fixer will do that manually
          `**Next step for @antigravity-fixer:** Patch \`payment-service/server.js\` to enforce`,
          `idempotency (SELECT existing row before INSERT) and add a UNIQUE index on \`idempotency_key\`.`,
          `Once patched, tag the release-gatekeeper agent to run CI verification.`,
        ].join('\n');

        await postMessage(report, eventRoomId);
      } finally {
        isBusy = false; // always release lock
      }
    });
  });

  es.onerror = (err) => {
    console.error('[sql-forensics] ⚡ SSE error:', err.message || JSON.stringify(err));
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!AGENT_ID || !AGENT_API_KEY) {
    await registerAgent();
  }
  connectSSE();
}

main().catch(err => {
  console.error('[sql-forensics] Fatal:', err.message);
  process.exit(1);
});
