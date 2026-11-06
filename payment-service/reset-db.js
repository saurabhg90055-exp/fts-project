/**
 * payment-service/reset-db.js
 * Deletes and re-seeds payments.db with the BUGGY duplicate data.
 * Run: npm run reset
 *
 * Use this to restart the demo from scratch.
 */

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');

const dbPath = path.join(__dirname, 'payments.db');

// Delete existing DB
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('🗑️  Deleted existing payments.db');
}

// Create fresh DB with buggy seed data
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error('❌ Could not create DB:', err.message); process.exit(1); }
});

db.serialize(() => {
  db.run(`CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    card_last4 TEXT,
    amount INTEGER,
    idempotency_key TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed with DUPLICATE rows — this is the bug we're demonstrating
  const stmt = db.prepare(
    `INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status)
     VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run('arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED');
  stmt.run('arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED'); // BUG: duplicate!
  stmt.finalize();

  db.close(() => {
    console.log('✅ payments.db reset with buggy seed data (2 duplicate rows for idem_tx_901)');
    console.log('');
    console.log('Next steps:');
    console.log('  1. npm run start:buggy    ← start the buggy payment API');
    console.log('  2. npm test               ← confirm 1 test fails');
    console.log('  3. npm run start:forensics');
    console.log('  4. npm run start:gatekeeper');
    console.log('  5. Post alert in Discord → @sql-forensics investigate');
  });
});

