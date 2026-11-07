# PayGuard Switch 🛡️

> **Autonomous FinTech Incident War-Room** — Switch AI + Antigravity multi-agent idempotency repair pipeline.

[![Hackathon](https://img.shields.io/badge/Flip%20The%20Switch-Hackathon%20Submission-blueviolet)](https://github.com/saurabhg90055-exp/fts-project)
[![Switch Version](https://img.shields.io/badge/Switch%20Console-v0.40.1-blue)](https://switchagents.ai)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🏛️ Architecture Overview

```
[Faulty Node.js + SQLite Payment API]  (Port 4000 — Double-charges customers on retry)
               │
               ▼ (Customer reports duplicate charge)
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SWITCH AI — Cloud Switch Workspace                     │
│                    Room: #fintech-war-room | Bridge: Discord                │
│                                                                             │
│  Shared Room Material & Governance:                                         │
│   • Rule 1 (PII Compliance): Mask all credit card numbers in messages.      │
│   • Rule 2 (Production Gate): No deployment without human "Approved" signoff│
│   • Shared State: Real-time SSE event stream, Tasks & Decisions log         │
└──────────────┬───────────────────────────┬──────────────────────────┬───────┘
               │ (SSE / HTTP Protocol)     │ (Native Connector / MCP) │ (SSE / HTTP Protocol)
               ▼                           ▼                          ▼
   ┌─────────────────────┐     ┌──────────────────────┐   ┌────────────────────────┐
   │ @sql-forensics      │     │ @antigravity-fixer   │   │ @release-gatekeeper    │
   │ (Custom Node Agent) │────▶│ (Antigravity Pro)    │──▶│ (Custom Node Agent)    │
   │ Queries live SQLite │     │ Writes idempotency   │   │ Verifies Room Rules,   │
   │ DB, masks PII, finds│     │ code fix & runs      │   │ runs CI test suite,    │
   │ duplicate charges   │     │ unit tests           │   │ awaits human approval  │
   └─────────────────────┘     └──────────────────────┘   └────────────────────────┘
               │                           │                          │
               └───────────────────────────┼──────────────────────────┘
                                           │
                               ┌───────────▼────────────┐
                               │  Discord #fintech-     │
                               │  war-room Channel      │
                               │  Bot: playSwitch       │
                               │  Human: @Engineer      │
                               └────────────────────────┘
```

---

## 💡 The Problem & The Solution

- **The Problem:** In financial payment systems, network interruptions cause clients and SDKs to retry `POST /api/v1/charge`. Without an atomic idempotency check, multiple charge rows are created for the same transaction, billing customers twice, creating customer support escalations, and risking unmasked card PII leaks during manual triage.
- **The Solution:** **PayGuard Switch** deploys a collaborative multi-agent incident response room in Discord powered by Switch AI:
  1. **`@sql-forensics`** analyzes the database, detects duplicate idempotency keys, and guarantees PII masking (`****-****-****-LAST4`).
  2. **`@antigravity-fixer`** analyzes the incident, writes an atomic `SELECT-or-INSERT` idempotency patch in `server.js`, and creates a database unique constraint.
  3. **`@release-gatekeeper`** executes the CI regression test suite and enforces a **Human-in-the-Loop** gate before deployment can proceed.

---

## 🛡️ Enforced Room Rules

| Rule | Title | Enforcement |
|:---|:---|:---|
| **Rule 1** | **PII Compliance** | Credit card numbers are never posted raw in chat. Automatically masked to `****-****-****-LAST4`. |
| **Rule 2** | **Production Gate** | No patch or hotfix is deployed without an explicit human `Approved` message typed in the room. |

---

## 📁 Project Structure

```
payguard-switch/
├── payment-service/
│   ├── server.js                   # Express Payment API + SQLite DB (Port 4000)
│   ├── server.buggy.js             # Initial incident state (double-charge bug)
│   ├── reset-db.js                 # Reverts server & reseeds duplicate DB state
│   ├── test.js                     # Automated 3-stage idempotency test suite
│   └── trigger-alert.js            # Live simulation script verifying retry safety
├── agents/
│   ├── sql-forensics.js            # Custom Agent #1: SQLite Inspector + PII Masker
│   └── release-gate.js             # Custom Agent #2: CI Runner + Human Approval Gate
├── fintech-war-room.template.yaml  # Declarative Switch Room template
├── .env.example                    # Environment variable template
├── package.json
├── PRD.md                          # Full Product Requirements Document
└── README.md                       # Documentation
```

---

## 🚀 Quick Start Guide

### Step 1 — Install Dependencies
```bash
npm install
```

### Step 2 — Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
copy .env.example .env
```
Fill in the values from your **Switch Console**:
```env
# Switch Console API URL (Local: http://localhost:8080 or Codespaces preview URL)
SWITCH_URL=http://localhost:8080

# Room ID from Switch Console -> Your Rooms -> fintech-war-room
SWITCH_ROOM_ID=PASTE_YOUR_ROOM_ID_HERE

# Messaging app connected to Discord
SWITCH_MESSAGING_APP=playSwitch

# Agent Registration Keys (from Switch Console -> Full Admin Interface -> API Keys)
SQL_AGENT_TOKEN=PASTE_SQL_FORENSICS_REGISTRATION_KEY_HERE
GATE_AGENT_TOKEN=PASTE_GATEKEEPER_REGISTRATION_KEY_HERE
```

### Step 3 — Initialize Incident State
Reset the database with the pre-seeded duplicate transaction bug:
```bash
npm run reset
```

### Step 4 — Launch Services (3 Terminals)

- **Terminal 1 (Payment API):**
  ```bash
  npm run start:api
  ```
- **Terminal 2 (SQL Forensics Agent):**
  ```bash
  npm run start:forensics
  ```
- **Terminal 3 (Release Gatekeeper Agent):**
  ```bash
  npm run start:gatekeeper
  ```

---

## 🎬 Incident Response Demo Walkthrough

1. **Trigger Incident:** In Discord `#fintech-war-room`, type:
   ```text
   🚨 Alert: Customer arjun@example.com reported double-charge on /api/v1/charge! @sql-forensics investigate.
   ```
2. **Forensics Report:** `@sql-forensics` inspects `payments.db`, reports duplicate key `idem_tx_901`, calculates estimated overcharge (`$49.99`), masks card `****-****-****-3344`, and tags `@antigravity-fixer`.
3. **Idempotency Hotfix:** `@antigravity-fixer` inspects `payment-service/server.js`, patches the endpoint with idempotency checks, and tags `@release-gatekeeper`.
4. **CI Testing:** `@release-gatekeeper` runs `npm test`, confirms tests pass, and blocks deployment:
   ```text
   ⚠️ Human Permission Gate — Room Rule #2:
   @Engineer All tests are green. Please type `Approved` to deploy.
   ```
5. **Human Sign-Off:** Type `Approved` in Discord. The gatekeeper verifies permission, confirms hotfix deployment, and logs the decision.
6. **Live Verification:** Run `npm run trigger` in terminal to confirm duplicate charges are now cleanly prevented (`Duplicate prevented`).

---

## 🔑 Key Bug & Idempotency Fix

### The Bug (`server.buggy.js`)
```javascript
// BUGGY: Inserts unconditionally without verifying existing idempotency_key
app.post('/api/v1/charge', (req, res) => {
  const { user_email, card_last4, amount, idempotency_key } = req.body;
  db.run(
    `INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status) VALUES (?, ?, ?, ?, 'CAPTURED')`,
    [user_email, card_last4, amount, idempotency_key],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ transaction_id: this.lastID, status: 'CAPTURED' });
    }
  );
});
```

### The Fix (`server.js`)
```javascript
// PATCHED: Checks for existing idempotency_key and returns existing transaction
app.post('/api/v1/charge', (req, res) => {
  const { user_email, card_last4, amount, idempotency_key } = req.body;

  db.get(
    `SELECT id, status, idempotency_key FROM transactions WHERE idempotency_key = ?`,
    [idempotency_key],
    (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });
      if (existing) {
        return res.status(200).json({
          transaction_id: existing.id,
          status: existing.status,
          idempotency_key: existing.idempotency_key,
        });
      }

      db.run(
        `INSERT INTO transactions (user_email, card_last4, amount, idempotency_key, status) VALUES (?, ?, ?, ?, 'CAPTURED')`,
        [user_email, card_last4, amount, idempotency_key],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
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
```

---

## 🧪 Testing

Run automated tests against the running API:
```bash
npm test
```
- **Before Fix:** 6 passed, 1 failed (duplicate charge occurs).
- **After Fix:** 7 passed, 0 failed (idempotency verified).

---

## 📜 License
MIT © 2026 PayGuard Switch Team
