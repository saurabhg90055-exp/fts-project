# PayGuard Switch 🛡️

> **Autonomous FinTech Incident War-Room** — A collaborative multi-agent pipeline powered by **Switch AI**, **Discord**, and **Google Antigravity** that autonomously investigates, patches, tests, and deploys fixes for payment double-charge incidents in under 2 minutes.

**Project:** PayGuard Switch  
**Author:** Saurabh Gupta, Anikha Padala   
**Date:** November 2026  
**Hackathon Deadline:** November 7, 2026 — 11:59 PM IST

---

##  The Problem: The "Double-Charge" Nightmare

Imagine you are paying \$49.99 on an app, but your mobile connection flickers. The app's payment SDK automatically retries the network request with the same `idempotency_key` (`idem_tx_901`).

```
Mobile App / SDK Retry (Same idempotency_key)
                 │
                 ▼
     POST /api/v1/charge
                 │
                 ▼ (BUG: Blind INSERT without SELECT check)
   ┌───────────────────────────┐
   │ SQLite transactions table │
   ├───────────────────────────┤
   │ Row 1: $49.99 (CAPTURED)  │
   │ Row 2: $49.99 (CAPTURED)  │ 💸 Customer charged $99.98 instead of $49.99!
   └───────────────────────────┘
```

### Why this is a critical crisis in production:
1. **Financial Loss & Chargebacks:** Customers are billed twice, triggering angry support tickets, high bank dispute fees, and lost customer trust.
2. **Slow, Stressful Manual Triage:** On-call engineers are paged at 2 AM to manually SSH into servers, query SQL databases, write a hotfix, test it, and deploy.
3. **Privacy (PII) Violations:** Under pressure, engineers frequently paste raw SQL outputs containing real credit card numbers and emails directly into Slack or Discord war-rooms, violating PCI-DSS and privacy regulations.
4. **Dangerous "Fly-by-Night" Hotfixes:** Rushed code changes often crash production (e.g., adding a `UNIQUE` database constraint when duplicate rows already exist in the database causes immediate engine crashes).

---

## 💡 What PayGuard Switch Solves.

**PayGuard Switch replaces the stressful, error-prone manual triage process with an autonomous team of AI agents living in a Discord war-room.**

Instead of engineers panicking in chat channels, three specialized Switch AI agents collaborate in real-time:

- 🔍 **Instant Forensic Investigation:** `@sql-forensics` queries the live payment database, calculates total overcharges, and **automatically masks sensitive card numbers** (complying with Room Rule #1).
- 🛠️ **Autonomous Code Repair:** `@antigravity-fixer` reads the root cause, synthesizes a robust idempotency check, safely migrates dirty records, and patches the server code live.
- 🧪 **Automated CI Gate:** `@release-gatekeeper` executes the test suite against the running server to prove all retries now return the original transaction ID without creating duplicate charges.
- 🛡️ **Human-in-the-Loop Safety:** Per Room Rule #2, no code can be deployed without explicit human approval. The engineer simply reviews the green CI tests and types **`Approved`** in Discord to deploy the hotfix and record a permanent audit entry into the Switch Console.

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
