/**
 * payment-service/reset-db.js
 * Resets the demo to the initial incident position:
 *   1. Reverts payment-service/server.js to the unpatched (buggy) version.
 *   2. Recreates transactions table with the 2 duplicate rows for idem_tx_901.
 *
 * Windows-safe: Uses DROP TABLE instead of unlinkSync so it succeeds even
 * if server or agent is still running with an open handle.
 *
 * Run: npm run reset
 */

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');

const dbPath          = path.join(__dirname, 'payments.db');
const serverPath      = path.join(__dirname, 'server.js');
const serverBuggyPath = path.join(__dirname, 'server.buggy.js');

// 1. Revert server.js back to buggy state
if (fs.existsSync(serverBuggyPath)) {
  fs.copyFileSync(serverBuggyPath, serverPath);
  console.log('🔄 Reverted payment-service/server.js to buggy state');
}

// 2. Try unlink, or fall back to SQL table recreation if file is locked
try {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('🗑️  Deleted existing payments.db');
  }
} catch {
  // File is open by another process (Windows EBUSY) — we will reset via SQL
  console.log('⚡ payments.db in use — resetting schema via SQL');
}

// 3. Recreate table and seed with buggy duplicate rows
const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run(`DROP TABLE IF EXISTS transactions`);
  db.run(`DROP INDEX IF EXISTS idx_transactions_idempotency_key`);
  db.run(`DROP INDEX IF EXISTS idx_idempotency_key`);

  db.run(`CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT, card_last4 TEXT, amount INTEGER,
    idempotency_key TEXT, status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const stmt = db.prepare(`INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status) VALUES (?, ?, ?, ?, ?)`);
  stmt.run('arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED');
  stmt.run('arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED'); // BUG: duplicate!
  stmt.finalize();

  db.close(() => {
    console.log('✅ Database reset with 2 duplicate rows (idem_tx_901)');
    console.log('');
    console.log('Demo initial state ready:');
    console.log('  1. Restart payment API: npm run start:api   (Terminal 1)');
    console.log('  2. Verify bug:          npm test            (will show: 6 passed, 1 failed)');
  });
});
