const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, 'payments.db');
const db = new sqlite3.Database(dbPath);

// Seed database with duplicate charge data (this is the bug we're demonstrating)
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

  db.get("SELECT COUNT(*) as count FROM transactions", (err, row) => {
    if (row && row.count === 0) {
      // Seeds two identical rows with the same idempotency_key — double charge!
      db.run(
        `INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status) VALUES (?, ?, ?, ?, ?)`,
        ['arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED']
      );
      db.run(
        `INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status) VALUES (?, ?, ?, ?, ?)`,
        ['arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED']
      );
    }
  });
});

// BUGGY ENDPOINT: Does NOT check idempotency_key before inserting.
// Every call creates a new row — causing double charges.
// Antigravity will patch this handler to check existing idempotency_key first.
app.post('/api/v1/charge', (req, res) => {
  const { user_email, card_last4, amount, idempotency_key } = req.body;

  db.run(
    `INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status)
     VALUES (?, ?, ?, ?, 'CAPTURED')`,
    [user_email, card_last4, amount, idempotency_key],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({
        transaction_id: this.lastID,
        status: 'CAPTURED',
      });
    }
  );
});

app.listen(4000, () => console.log('Payment API running on http://localhost:4000'));

