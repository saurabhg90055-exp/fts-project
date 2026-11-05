# PayGuard Switch 🛡️

> **Autonomous FinTech Incident War-Room** — Switch AI + Antigravity multi-agent idempotency repair pipeline.

```
[Faulty Node.js + SQLite Payment API]  (Port 4000 - Double-charges customers on retry)
               │
               ▼ (Throws 500 / Duplicate Charge Alert)
┌─────────────────────────────────────────────────────────────────────────┐
│                    SWITCH AI ROOM: #fintech-war-room                    │
│  Shared Room Material:                                                  │
│   • Rules: 1. Mask all card numbers (PII). 2. Require human sign-off.  │
│   • Tasks: Auto-created & updated by agents during triage               │
│   • Decisions: Permanent post-mortem audit log                          │
└──────────┬───────────────────────────┬──────────────────────────┬───────┘
           │ (SSE / HTTP Protocol)     │ (Native Connector)       │ (SSE / HTTP Protocol)
           ▼                           ▼                          ▼
┌─────────────────────┐    ┌──────────────────────┐   ┌────────────────────────┐
│ @sql-forensics      │    │ @antigravity-fixer   │   │ @release-gatekeeper    │
│ (Custom Node Agent) │───▶│ (Antigravity Pro)    │──▶│ (Custom Node Agent)    │
│ Queries live SQLite │    │ Writes idempotency   │   │ Verifies Room Rules,   │
│ DB, masks PII, finds│    │ code fix & runs      │   │ runs test suite, asks  │
│ duplicate txns      │    │ unit tests           │   │ @Saurabh for sign-off  │
└─────────────────────┘    └──────────────────────┘   └────────────────────────┘
```

## 📁 Project Structure

```
payguard-switch/
├── payment-service/
│   ├── server.js          # Buggy FinTech Express API + SQLite DB (Port 4000)
│   └── test.js            # Automated idempotency verification test suite
├── agents/
│   ├── sql-forensics.js   # Custom Switch Agent #1 — DB Inspector + PII Masker
│   └── release-gate.js    # Custom Switch Agent #2 — Compliance & Deploy Gate
├── fintech-war-room.template.yaml  # Switch Room Template (reference)
├── .env.example           # Environment variable template
├── package.json
└── README.md
```

## 🚀 3-Step Quick Start

### Step 1 — Install dependencies
```bash
npm install
```

### Step 2 — Configure environment
```bash
copy .env.example .env
# No changes needed — default tokens work out of the box
```

### Step 3 — Start all services (4 terminals)
```bash
# Terminal 1 — Local Switch server (war-room UI + SSE hub)
npm run start:switch

# Terminal 2 — Buggy payment API
npm run start:api

# Terminal 3 — SQL forensics agent
npm run start:forensics

# Terminal 4 — Release gatekeeper agent
npm run start:gatekeeper
```

Open the war-room UI at **http://localhost:8080/ui** and paste:
```
🚨 Alert: Customer reported double-charge on /api/v1/charge! @sql-forensics investigate.
```

## 🧪 Running Tests
```bash
# Make sure the payment API is running first (npm run start:api)
npm test
```

## 🏗️ How It Works

| Step | Agent | Action |
|------|-------|--------|
| 1 | `@sql-forensics` | Queries `payments.db`, masks PII, finds duplicate `idempotency_key` |
| 2 | `@antigravity-fixer` | Reads report, patches `server.js` to check key before inserting |
| 3 | `@release-gatekeeper` | Runs test suite, enforces human approval (Room Rule #2) |
| 4 | Human (`@Saurabh`) | Types `Approved` → hotfix deployed, decision logged |

## 🔑 Key Bug & Fix

**Bug:** `POST /api/v1/charge` inserts a new row for every request — even retries with the same `idempotency_key`.

**Fix:** Check for existing `idempotency_key` before inserting:
```js
// PATCHED handler (applied by @antigravity-fixer)
db.get(`SELECT id, status FROM transactions WHERE idempotency_key = ?`, [idempotency_key], (err, row) => {
  if (row) return res.status(200).json({ transaction_id: row.id, status: row.status });
  // proceed with INSERT only if no existing row
});
```

## 🌐 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SWITCH_URL` | Local Switch server URL | `http://localhost:8080` |
| `SWITCH_ROOM_ID` | Room identifier (any string) | `war-room-001` |
| `SQL_AGENT_TOKEN` | Token for `@sql-forensics` | `token-sql-forensics-dev` |
| `GATE_AGENT_TOKEN` | Token for `@release-gatekeeper` | `token-release-gatekeeper-dev` |

> **No Docker or Switch Console required.** `switch-local.js` is a self-contained SSE hub + war-room UI that runs entirely in Node.js.

## 📜 License
MIT

