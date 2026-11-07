# PayGuard Switch 🛡️

> **Autonomous FinTech Incident War-Room** — Multi-agent incident triage and idempotency repair pipeline powered by **Switch AI**, **Discord**, and **Google Antigravity**.

---

## 🏛️ System Architecture

```
       [Faulty Node.js + SQLite Payment API] (Port 4000 - Double-charges customers on network retry)
                                    │
                                    ▼ (Throws Duplicate Charge Alert)
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               SWITCH AI ROOM: #fintech-war-room                                 │
│                               (Bridged to Discord via playSwitch bot)                           │
│  Shared Room Material:                                                                          │
│   • Room Rule #1: Mask all card numbers & PII before posting to room.                           │
│   • Room Rule #2: Require explicit human sign-off ("Approved") before hotfix deployment.        │
│   • Decisions Log: Permanent post-mortem audit trail stored in Switch Console.                  │
└──────────────┬─────────────────────────────┬─────────────────────────────┬──────────────────────┘
               │ (SSE / HTTP)                │ (SSE / HTTP)                │ (SSE / HTTP)
               ▼                             ▼                             ▼
┌─────────────────────────────┐┌─────────────────────────────┐┌─────────────────────────────┐
│       @sql-forensics        ││     @antigravity-fixer      ││     @release-gatekeeper     │
│   (Custom Switch Agent #1)  ││   (Custom Switch Agent #2)  ││   (Custom Switch Agent #3)  │
│ • Queries live payments.db  ││ • Wakes up on mention       ││ • Listens on SSE            │
│ • Masks credit card PII     ││ • Patches server.js live    ││ • Runs live CI test suite   │
│ • Finds duplicate charges   ││ • Adds idempotency check    ││ • Enforces Room Rule #2     │
│ • Estimates $49.99 loss     ││ • Deduplicates old data     ││ • Pauses for human gate     │
│ • Hands off to fixer agent  ││ • Posts hotfix diff to room ││ • Logs permanent decision   │
└─────────────────────────────┘└─────────────────────────────┘└─────────────────────────────┘
                                                                             │
                                                                             ▼ (Human Gate)
                                                               ┌───────────────────────────┐
                                                               │  Human On-Call Engineer   │
                                                               │  Types "Approved" in chat │
                                                               │  Hotfix deployed to prod! │
                                                               └───────────────────────────┘
```

---

## 📁 Project Structure

```
payguard-switch/
├── payment-service/
│   ├── server.js               # Active payment API server (Port 4000)
│   ├── server.buggy.js         # Frozen buggy server reference (used by reset)
│   ├── server.patched.js       # Verified patched server reference
│   ├── reset-db.js             # Reset script: restores buggy server + seeds duplicate DB
│   ├── test.js                 # Automated idempotency verification test suite
│   └── trigger-alert.js        # Helper script to trigger incident alerts
├── agents/
│   ├── sql-forensics.js        # Switch Agent #1 — Database Inspector & PII Masker
│   ├── antigravity-fixer.js    # Switch Agent #2 — Autonomous AI Code Repair Agent
│   └── release-gate.js         # Switch Agent #3 — Compliance & Release Gatekeeper
├── script.md                   # Video recording walkthrough script (~2.5 minutes)
├── GUIDE.md                    # Comprehensive setup & hackathon guide
├── fintech-war-room.template.yaml # Switch room template definition
├── .env.example                # Environment variable configuration template
├── package.json
└── README.md
```

---

## ⚡ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
`.env`:
```bash
.env
```
Fill in your credentials from the Switch Console:
```env
SWITCH_URL=http://localhost:8080
SWITCH_ROOM_ID=your_room_id
SWITCH_MESSAGING_APP=playSwitch

# Registration Tokens (from Switch Console → Full Admin Interface → API Keys)
SQL_AGENT_TOKEN=your_sql_forensics_token
FIXER_AGENT_TOKEN=your_antigravity_fixer_token
GATE_AGENT_TOKEN=your_release_gatekeeper_token
```

---

## 🎬 Running the Incident War-Room 

Open **5 terminal tabs/windows**:

### Terminal 1 — Start the Payment API
```bash
npm run start:api
```

### Terminal 2 — Prove the Incident (Tests Fail)
```bash
npm test
```
> 🎯 **Expected:** **6 passed, 1 failed**
> `❌ FAIL: Same transaction_id returned (no duplicate) → Expected 3, Got 4`
> Demonstrates that network retries trigger duplicate charges without idempotency.

### Terminal 3 — Start SQL Forensics Agent
```bash
npm run start:forensics
```

### Terminal 4 — Start Antigravity Fixer Agent
```bash
npm run start:fixer
```

### Terminal 5 — Start Release Gatekeeper Agent
```bash
npm run start:gatekeeper
```

---

## 🔄 End-to-End Incident Lifecycle in Discord

1. **Trigger Incident:** In Discord `#fintech-war-room`, post the alert:
   ```text
   🚨 Alert: Customer arjun@example.com reported a double-charge of $99.98 on /api/v1/charge! @sql-forensics investigate immediately.
   ```

2. **Autonomous Forensics:**
   - `@sql-forensics` inspects `payments.db`.
   - Masks credit card numbers: `****-****-****-3344` (Room Rule #1 compliance).
   - Identifies duplicate key `idem_tx_901` and overcharge of `$49.99 USD`.
   - Hands off by tagging `👉 @antigravity-fixer`.

3. **Autonomous Code Repair:**
   - `@antigravity-fixer` catches the mention over SSE.
   - Automatically patches `payment-service/server.js` live without manual prompt.
   - Adds pre-lookup check (`SELECT ... WHERE idempotency_key = ?`), startup table deduplication migration, and database `UNIQUE` index.
   - Posts hotfix diff into Discord.

4. **Reload Payment Server:**
   - In Terminal 1, press `Ctrl+C` and restart `npm run start:api`.

5. **CI Verification:**
   - In Discord, tag the gatekeeper:
     ```text
     @release-gatekeeper The patch is applied to payment-service/server.js. Run CI verification.
     ```
   - `@release-gatekeeper` runs the test suite against the live server:
     **7 passed, 0 failed** ✅.

6. **Human Permission Gate (Room Rule #2):**
   - The gatekeeper pauses deployment and requests human sign-off.
   - In Discord, type:
     ```text
     Approved
     ```
   - `@release-gatekeeper` deploys the hotfix and permanently records the incident decision into the **Switch Console Decisions log**.

---

## 🔁 Restarting

To restart the system back to the initial state (**6 passed, 1 failed**) at any time:

```bash
npm run reset
```
This automatically:
- Reverts `payment-service/server.js` back to the buggy version.
- Re-seeds `payments.db` with duplicate charge rows (`idem_tx_901`).

---

## 📜 Room Rules & Compliance

| Rule | Enforcement | Agent Responsible |
|---|---|---|
| **Room Rule #1 (PII Masking)** | All credit card numbers must be masked to `****-****-****-XXXX` | `@sql-forensics` |
| **Room Rule #2 (Human Sign-Off)** | No hotfix may be deployed without explicit `Approved` confirmation | `@release-gatekeeper` |

---

## 📄 License
MIT
