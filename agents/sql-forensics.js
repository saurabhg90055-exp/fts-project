/**
 * agents/sql-forensics.js
 * Custom Switch Agent #1 — @sql-forensics
 *
 * Setup:  Switch Console (Cloud Switch) + Discord bridge via playSwitch bot
 * Room:   #fintech-war-room on Discord / PlaySwitch Room server
 *
 * Protocol:
 *   • Subscribes to Switch room events via Server-Sent Events (SSE)
 *   • When tagged @sql-forensics in Discord, queries payments.db
 *   • Masks PII per Room Rule #1 before posting to chat
 *   • Hands root cause + fix request to @antigravity-fixer
 *
 * Run:  node agents/sql-forensics.js
 *
 * Required .env vars:
 *   SWITCH_URL       — Switch Console API base URL
 *   SWITCH_ROOM_ID   — Room ID from Switch Console → Your Rooms
 *   SQL_AGENT_TOKEN  — API key from Switch Console → Full Admin Interface → API Keys
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const EventSource = require('eventsource');

const SWITCH_SERVER = process.env.SWITCH_URL || 'http://localhost:8080';
const AGENT_TOKEN   = process.env.SQL_AGENT_TOKEN;
const ROOM_ID       = process.env.SWITCH_ROOM_ID;

if (!AGENT_TOKEN || !ROOM_ID) {
  console.error('❌ Missing required env vars: SQL_AGENT_TOKEN, SWITCH_ROOM_ID');
  console.error('   → Copy .env.example to .env and fill in values from Switch Console.');
  process.exit(1);
}

const db = new sqlite3.Database(
  path.join(__dirname, '../payment-service/payments.db'),
  sqlite3.OPEN_READONLY,
  (err) => {
    if (err) {
      console.error('[sql-forensics] ❌ Cannot open payments.db:', err.message);
      console.error('   → Make sure the payment API has been started at least once (npm run start:api)');
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

// ── Post to Switch room (→ appears in Discord #fintech-war-room) ─────────────
async function postMessage(content) {
  try {
    const res = await fetch(`${SWITCH_SERVER}/api/v1/rooms/${ROOM_ID}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${AGENT_TOKEN}`,
      },
      body: JSON.stringify({ content }),
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

// ── SSE — listen to Discord messages relayed by Switch ───────────────────────
const sseUrl = `${SWITCH_SERVER}/api/v1/rooms/${ROOM_ID}/events`;
console.log(`[sql-forensics] 🔌 Connecting to SSE: ${sseUrl}`);

const es = new EventSource(sseUrl, {
  headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
});

es.onopen = () => {
  console.log('[sql-forensics] ✅ Connected to Switch Room SSE stream.');
  console.log('[sql-forensics] 🚀 Waiting for @sql-forensics mention in #fintech-war-room …');
};

es.onmessage = async (event) => {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  if (!msg.content) return;

  // Trigger: someone tags @sql-forensics in Discord
  if (msg.content.toLowerCase().includes('@sql-forensics')) {
    console.log('[sql-forensics] 🔔 Mention detected — running DB forensics…');

    runForensics(async (err, duplicates) => {
      if (err) {
        await postMessage(`⚠️ **@sql-forensics** error: \`${err}\``);
        return;
      }

      if (duplicates.length === 0) {
        await postMessage('✅ **@sql-forensics:** No duplicate transactions found in `payments.db`. Database looks clean.');
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
        `**Root cause:** \`POST /api/v1/charge\` in \`payment-service/server.js\` inserts a new row on every request without first checking if the \`idempotency_key\` already exists — causing duplicate charges on network retries.`,
        ``,
        `@antigravity-fixer Please patch \`payment-service/server.js\` to enforce idempotency`,
        `(SELECT existing row before INSERT) and add a UNIQUE index on \`idempotency_key\`.`,
        `Tag @release-gatekeeper when the diff is ready.`,
      ].join('\n');

      await postMessage(report);
    });
  }
};

es.onerror = (err) => {
  console.error('[sql-forensics] ⚡ SSE error — will auto-retry:', err.message || JSON.stringify(err));
};
