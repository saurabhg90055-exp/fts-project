
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, 'payments.db');
const db = new sqlite3.Database(dbPath);

// Initialize database
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

  // Step 1: Remove duplicate records before creating unique index.
  // Keep the transaction with the smallest ID for each key.
  // NULL idempotency keys are excluded.
  db.run(`
    DELETE FROM transactions
    WHERE idempotency_key IS NOT NULL
    AND id NOT IN (
      SELECT MIN(id)
      FROM transactions
      WHERE idempotency_key IS NOT NULL
      GROUP BY idempotency_key
    )
  `);

  // Step 2: Create unique index.
  // Prevents duplicate idempotency keys.
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_key
    ON transactions(idempotency_key)
  `);

  // Step 3: Seed database if empty.
  db.get(
    "SELECT COUNT(*) AS count FROM transactions",
    (err, row) => {
      if (err) {
        console.error('Database error:', err.message);
        return;
      }

      if (row && row.count === 0) {
        db.run(
          `INSERT OR IGNORE INTO transactions
          (user_email, card_last4, amount, idempotency_key, status)
          VALUES (?, ?, ?, ?, ?)`,
          [
            'arjun@example.com',
            '3344',
            4999,
            'idem_tx_901',
            'CAPTURED'
          ],
          (err) => {
            if (err) {
              console.error('Seed error:', err.message);
            }
          }
        );
      }
    }
  );
});

// PAYMENT CHARGE API
app.post('/api/v1/charge', (req, res) => {

  const {
    user_email,
    card_last4,
    amount,
    idempotency_key
  } = req.body;

  // Step 1: Validate required fields.
  if (!user_email || !card_last4 || !amount || !idempotency_key) {
    return res.status(400).json({
      error: 'Missing required fields'
    });
  }

  // Step 2: Validate amount.
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return res.status(400).json({
      error: 'Amount must be a positive integer'
    });
  }

  // Step 3: Validate last four card digits.
  if (!/^\d{4}$/.test(card_last4)) {
    return res.status(400).json({
      error: 'card_last4 must contain exactly 4 digits'
    });
  }

  // Step 4: Check whether idempotency key already exists.
  db.get(
    `SELECT id, status, idempotency_key
     FROM transactions
     WHERE idempotency_key = ?`,
    [idempotency_key],
    (err, existing) => {

      if (err) {
        return res.status(500).json({
          error: err.message
        });
      }

      // Existing transaction: return the same transaction.
      if (existing) {
        return res.status(200).json({
          transaction_id: existing.id,
          status: existing.status,
          idempotency_key: existing.idempotency_key
        });
      }

      // Step 5: Insert new transaction.
      db.run(
        `INSERT INTO transactions
        (user_email, card_last4, amount, idempotency_key, status)
        VALUES (?, ?, ?, ?, 'CAPTURED')`,
        [
          user_email,
          card_last4,
          amount,
          idempotency_key
        ],
        function (err) {

          if (err) {

            // Handle simultaneous requests using the same key.
            if (err.code === 'SQLITE_CONSTRAINT') {

              db.get(
                `SELECT id, status, idempotency_key
                 FROM transactions
                 WHERE idempotency_key = ?`,
                [idempotency_key],
                (selectErr, row) => {

                  if (selectErr) {
                    return res.status(500).json({
                      error: selectErr.message
                    });
                  }

                  if (!row) {
                    return res.status(500).json({
                      error: 'Transaction lookup failed'
                    });
                  }

                  return res.status(200).json({
                    transaction_id: row.id,
                    status: row.status,
                    idempotency_key: row.idempotency_key
                  });
                }
              );

              return;
            }

            return res.status(500).json({
              error: err.message
            });
          }

          // New transaction successfully created.
          return res.status(201).json({
            transaction_id: this.lastID,
            status: 'CAPTURED',
            idempotency_key
          });

        }
      );
    }
  );
});

// Start server
app.listen(4000, () => {
  console.log('Payment API running on http://localhost:4000');
});
