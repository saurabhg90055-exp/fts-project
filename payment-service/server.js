const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, 'payments.db');
const db = new sqlite3.Database(dbPath);

// Seed database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    card_last4 TEXT,
    amount INTEGER,
    idempotency_key TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // FIX: Deduplicate any existing rows BEFORE creating the unique index.
  // (Old buggy DB may have multiple rows with the same idempotency_key.)
  // Keep only the row with the smallest id for each key.
  db.run(`DELETE FROM transactions
          WHERE id NOT IN (
            SELECT MIN(id) FROM transactions GROUP BY idempotency_key
          )`);

  // Now safe to add UNIQUE index — no duplicates remain.
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_key
          ON transactions(idempotency_key)`);

  db.get("SELECT COUNT(*) as count FROM transactions", (err, row) => {
    if (row && row.count === 0) {
      // Seed a single clean row (no duplicates)
      db.run(
        `INSERT OR IGNORE INTO transactions (user_email, card_last4, amount, idempotency_key, status)
         VALUES (?, ?, ?, ?, ?)`,
        ['arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED']
      );
    }
  });
});

// FIX: Check idempotency_key before inserting.
// - 200 + existing transaction if key already exists (idempotent retry)
// - 201 + new transaction if key is genuinely new
app.post('/api/v1/charge', (req, res) => {
  const { user_email, card_last4, amount, idempotency_key } = req.body;

  if (!idempotency_key) {
    return res.status(400).json({ error: 'idempotency_key is required' });
  }

  // Step 1: SELECT existing row for this idempotency_key
  db.get(
    `SELECT id, status, idempotency_key FROM transactions WHERE idempotency_key = ?`,
    [idempotency_key],
    (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });

      // Key already exists → return existing transaction (no duplicate charge)
      if (existing) {
        return res.status(200).json({
          transaction_id: existing.id,
          status: existing.status,
          idempotency_key: existing.idempotency_key,
        });
      }

      // Key is new → safe to insert
      db.run(
        `INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status)
         VALUES (?, ?, ?, ?, 'CAPTURED')`,
        [user_email, card_last4, amount, idempotency_key],
        function (err) {
          if (err) {
            // Race condition safety net: another request inserted first
            if (err.code === 'SQLITE_CONSTRAINT') {
              db.get(
                `SELECT id, status, idempotency_key FROM transactions WHERE idempotency_key = ?`,
                [idempotency_key],
                (_, row) => res.status(200).json({
                  transaction_id: row?.id,
                  status: row?.status,
                  idempotency_key: row?.idempotency_key,
                })
              );
              return;
            }
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json({
            transaction_id: this.lastID,
            status: 'CAPTURED',
            idempotency_key,
          });
        }
      );
    }
  );
});

app.listen(4000, () => console.log('Payment API running on http://localhost:4000'));
