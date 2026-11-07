const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, 'payments.db');
const db = new sqlite3.Database(dbPath);

// Initialize database schema with idempotency enforcement
db.serialize(() => {
  // Create transactions table
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    card_last4 TEXT,
    amount INTEGER,
    idempotency_key TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: Deduplicate any existing duplicate rows before creating unique index
  // (Keeps the earliest record with the lowest id for each key)
  db.run(`DELETE FROM transactions
          WHERE id NOT IN (
            SELECT MIN(id) FROM transactions GROUP BY idempotency_key
          )`, (err) => {
    if (err) console.error('Deduplication migration error:', err.message);
  });

  // Enforce uniqueness at the database level on idempotency_key
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key
          ON transactions (idempotency_key)`, (err) => {
    if (err) console.error('Unique index creation error:', err.message);
  });

  // Seed single legitimate transaction if database is empty
  db.get('SELECT COUNT(*) as count FROM transactions', (err, row) => {
    if (row && row.count === 0) {
      db.run(
        `INSERT OR IGNORE INTO transactions (user_email, card_last4, amount, idempotency_key, status)
         VALUES (?, ?, ?, ?, ?)`,
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
    `SELECT id, status FROM transactions WHERE idempotency_key = ?`,
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
        `INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status)
         VALUES (?, ?, ?, ?, 'CAPTURED')`,
        [user_email, card_last4, amount, idempotency_key],
        function (err) {
          if (err) {
            // Race condition fallback: concurrent request inserted first
            if (err.code === 'SQLITE_CONSTRAINT') {
              return db.get(
                `SELECT id, status FROM transactions WHERE idempotency_key = ?`,
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

