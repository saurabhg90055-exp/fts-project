# PayGuard Switch — Product Requirements Document (PRD)

**Project:** PayGuard Switch  
**Author:** crazysaurabh  
**Version:** 1.0  
**Date:** November 2026  
**Hackathon Deadline:** November 7, 2026 — 11:59 PM IST

---

## 1. Executive Summary

PayGuard Switch is an **autonomous multi-agent FinTech incident response system** that detects, diagnoses, patches, and deploys fixes for a critical payment double-charge bug — entirely through a **Discord war-room chat interface** powered by Switch AI. Human involvement is reduced to a single approval message.

---

## 2. Problem Statement

### The Bug
A production Node.js + SQLite payment API (`POST /api/v1/charge`) does **not check for existing `idempotency_key` records before inserting**. When a client retries a failed payment (common in mobile apps and FinTech SDKs), the server inserts a second charge row — billing the customer twice.

```
Client retry → POST /api/v1/charge (same idempotency_key)
                       ↓
              INSERT without SELECT check
                       ↓
              Duplicate row in DB → Customer charged twice 💸
```

### The Human Cost
- Customer `arjun@example.com` charged **$99.98 instead of $49.99**
- Idempotency key `idem_tx_901` has **2 rows** in `transactions` table
- Every future retry makes this worse

### The Solution
An autonomous 3-agent pipeline in a Switch AI room, bridged to Discord, that:
1. Detects the duplicate automatically
2. Writes and applies the idempotency fix
3. Runs a CI test suite
4. Requires a human "Approved" before deploying

---

## 3. Architecture

```
[Faulty Node.js + SQLite Payment API]  (Port 4000)
  POST /api/v1/charge — no idempotency check → double charges
               │
               ▼ (Incident detected)
┌─────────────────────────────────────────────────────────────────────────┐
│              SWITCH AI — Cloud Switch Workspace                         │
│              Bridge: playSwitch bot (@crazysaurabh)                     │
│              Discord: PlaySwitch Room / #fintech-war-room               │
│                                                                         │
│  Room Rules:                                                            │
│    Rule 1 — PII: Never post unmasked card numbers in chat               │
│    Rule 2 — Gate: No deployment without human "Approved" in chat        │
│                                                                         │
│  Room Shared State:                                                     │
│    • Messages: live chat history visible to all agents + humans         │
│    • Tasks: auto-created per agent mention                              │
│    • Decisions: permanent post-mortem audit log                         │
└──────────┬────────────────────────┬──────────────────────┬─────────────┘
           │ SSE / HTTP             │ Native (Antigravity  │ SSE / HTTP
           │ (Bearer token auth)    │  Pro connector)      │ (Bearer token auth)
           ▼                        ▼                      ▼
┌────────────────────┐  ┌─────────────────────┐  ┌──────────────────────┐
│  @sql-forensics    │  │  @antigravity-fixer  │  │  @release-gatekeeper │
│  Custom Node Agent │─▶│  Antigravity Pro     │─▶│  Custom Node Agent   │
│                    │  │                      │  │                      │
│  • Opens SQLite DB │  │  • Reads room history│  │  • Runs test suite   │
│  • Masks PII       │  │  • Patches server.js │  │  • Posts CI results  │
│  • Finds duplicates│  │  • Posts git diff    │  │  • Waits for human   │
│  • Hands off to    │  │  • Tags gatekeeper   │  │    "Approved"        │
│    @antigravity    │  │                      │  │  • Logs decision     │
└────────────────────┘  └─────────────────────┘  └──────────────────────┘
           │                        │                      │
           └────────────────────────┴──────────────────────┘
                                    │
                        ┌───────────▼────────────┐
                        │  Discord #fintech-war-room │
                        │  PlaySwitch Room server    │
                        │  Bot: playSwitch           │
                        │  Human: @crazysaurabh      │
                        └────────────────────────────┘
```

---

## 4. Infrastructure & Connections

| Component | Technology | Status |
|-----------|-----------|--------|
| Switch Console | Cloud Switch v0.40.1 | ✅ Running & Connected |
| Discord bridge | playSwitch bot (@crazysaurabh) | ✅ Connected |
| Discord server | PlaySwitch Room | ✅ Created |
| Discord channel | #fintech-war-room | ✅ Created |
| Payment API | Node.js + Express + SQLite | 🔧 To start locally |
| @sql-forensics | Node.js custom agent | 🔧 To register + start |
| @release-gatekeeper | Node.js custom agent | 🔧 To register + start |
| @antigravity-fixer | Antigravity Pro | 🔧 To add to room |

---

## 5. Agent Specifications

### 5.1 @sql-forensics (Custom Node Agent)

| Property | Value |
|----------|-------|
| File | `agents/sql-forensics.js` |
| Trigger | `@sql-forensics` mention in Discord room |
| Protocol | SSE (inbound) + HTTP POST (outbound) |
| Auth | Bearer token from Switch Console |

**Behavior:**
1. Connects to Switch room SSE stream on startup
2. Listens for `@sql-forensics` mention
3. Runs: `SELECT ... GROUP BY idempotency_key HAVING COUNT(*) > 1`
4. **Masks all card numbers** to `****-****-****-LAST4` (Room Rule #1)
5. Calculates estimated overcharge in USD
6. Posts JSON report to room (→ appears in Discord)
7. Tags `@antigravity-fixer` with root cause + fix request

**PII Masking Rule:**
```
Input:  "4242-8899-1122-3344"
Output: "****-****-****-3344"
```

### 5.2 @antigravity-fixer (Antigravity Pro — Native Connector)

| Property | Value |
|----------|-------|
| Provider | Antigravity Pro |
| Trigger | Tagged by @sql-forensics in room |
| Protocol | Native Switch connector |

**Behavior:**
1. Reads full room chat history (shared context)
2. Opens `payment-service/server.js`
3. Patches the `POST /api/v1/charge` handler:
   - Adds `SELECT id, status FROM transactions WHERE idempotency_key = ?`
   - Returns existing transaction if found (200 OK — idempotent)
   - Only inserts if no match found (201 Created)
   - Adds `CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency ON transactions(idempotency_key)`
4. Posts the git diff in the room chat
5. Tags `@release-gatekeeper`

**The Fix:**
```js
// BEFORE (buggy)
db.run(`INSERT INTO transactions ...`, [...], function(err) { ... });

// AFTER (patched by @antigravity-fixer)
db.get(`SELECT id, status FROM transactions WHERE idempotency_key = ?`, [idempotency_key], (err, existing) => {
  if (existing) return res.status(200).json({ transaction_id: existing.id, status: existing.status });
  db.run(`INSERT INTO transactions ...`, [...], function(err) { ... });
});
```

### 5.3 @release-gatekeeper (Custom Node Agent)

| Property | Value |
|----------|-------|
| File | `agents/release-gate.js` |
| Trigger | `@release-gatekeeper` mention by @antigravity-fixer |
| Protocol | SSE (inbound) + HTTP POST (outbound) |
| Auth | Bearer token from Switch Console |

**Behavior:**
1. Runs `node payment-service/test.js`
2. Posts full test output to room
3. If tests pass → invokes Human Permission Gate (Room Rule #2)
4. Waits for human to type `Approved` in Discord
5. On approval → posts deployment confirmation
6. Records post-mortem to Switch room Decisions log

---

## 6. Room Rules

| Rule | ID | Description | Enforced By |
|------|----|-------------|-------------|
| PII Compliance | Rule 1 | Never post unmasked credit card numbers. All card data masked to `****-****-****-LAST4`. | @sql-forensics (code-level masking) |
| Production Gate | Rule 2 | No hotfix or DB change deployed without explicit human `Approved` in chat. | @release-gatekeeper (blocks on approval) |

---

## 7. Test Suite Specification (`payment-service/test.js`)

| Test Case | Input | Expected Output |
|-----------|-------|----------------|
| TC-1: First charge | New `idempotency_key` | `201 Created`, new `transaction_id` |
| TC-2: Retry (same key) | Same `idempotency_key` | `200 OK`, **same** `transaction_id` (no duplicate) |
| TC-3: Different key | New unique `idempotency_key` | `201 Created`, **different** `transaction_id` |

All 3 must pass before @release-gatekeeper presents the human approval gate.

---

## 8. Data Model

### `transactions` table (SQLite)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment transaction ID |
| `user_email` | TEXT | Customer email |
| `card_last4` | TEXT | Full card string (masked in chat) |
| `amount` | INTEGER | Amount in cents |
| `idempotency_key` | TEXT | **Must be UNIQUE** (the fix adds this constraint) |
| `status` | TEXT | `CAPTURED` |
| `created_at` | DATETIME | Auto timestamp |

### Seed Data (the bug)
```sql
INSERT INTO transactions VALUES ('arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED');
INSERT INTO transactions VALUES ('arjun@example.com', '4242-8899-1122-3344', 4999, 'idem_tx_901', 'CAPTURED');
-- ↑ Same idempotency_key twice = $49.99 charged twice = $99.98 overcharge
```

---

## 9. File Structure

```
payguard-switch/
├── payment-service/
│   ├── server.js                    ← Buggy Express + SQLite API (Port 4000)
│   └── test.js                      ← Automated idempotency test suite (3 cases)
├── agents/
│   ├── sql-forensics.js             ← Custom Agent #1: DB forensics + PII masking
│   └── release-gate.js              ← Custom Agent #2: CI runner + human gate
├── fintech-war-room.template.yaml   ← Switch Room template for import
├── .env.example                     ← Environment variable template
├── .env                             ← Your local config (git-ignored)
├── package.json
├── PRD.md                           ← This document
└── README.md                        ← Public documentation
```

---

## 10. Environment Variables

| Variable | Source | Example |
|----------|--------|---------|
| `SWITCH_URL` | Switch Console → Full Admin Interface → API | `http://localhost:8080` |
| `SWITCH_ROOM_ID` | Switch Console → Your Rooms → room settings | `room_abc123` |
| `SQL_AGENT_TOKEN` | Switch Console → Full Admin Interface → API Keys | `sk_...` |
| `GATE_AGENT_TOKEN` | Switch Console → Full Admin Interface → API Keys | `sk_...` |

---

## 11. Demo Script (2-Minute Video)

| Segment | Duration | Action |
|---------|----------|--------|
| **Setup** | 0:00–0:20 | Show Switch Console (Cloud Switch, Connected) on left + Discord #fintech-war-room on right. Point out playSwitch bot, Room Rules. |
| **Trigger** | 0:20–0:45 | Paste: `🚨 Alert: Customer reported double-charge! @sql-forensics investigate.` Show @sql-forensics reply: masked card `****-****-****-3344`, duplicate key `idem_tx_901`, tag to @antigravity-fixer. |
| **Fix** | 0:45–1:15 | Show Antigravity Pro reading room history, editing `server.js`, posting git diff in Discord, tagging @release-gatekeeper. |
| **Gate** | 1:15–1:50 | Show @release-gatekeeper posting ✅ CI results. Type `Approved`. Show deployment confirmation + Decisions audit log updated. |

---

## 12. Submission Checklist

| Item | Status |
|------|--------|
| Public GitHub repo | ⬜ Push before Nov 7 |
| ASCII architecture diagram in README | ✅ Done |
| `fintech-war-room.template.yaml` | ✅ Done |
| 3-step run instructions in README | ✅ Done |
| 2-minute demo video | ⬜ Record |
| Wispr Flow scorecard screenshot | ⬜ Take screenshot |
| Hashnode/Dev.to blog post | ⬜ Write & publish |
| X + LinkedIn post `#HowISwitch` | ⬜ Post with video |

---

## 13. Success Criteria

| Criterion | Metric |
|-----------|--------|
| Duplicate detection | @sql-forensics finds `idem_tx_901` within 10s of mention |
| PII compliance | No unmasked card numbers appear in Discord chat |
| Idempotency fix | `POST /api/v1/charge` with same key returns same `transaction_id` |
| CI pass rate | All 3 test cases pass after patch |
| Human gate | Deployment blocked until `Approved` typed in Discord |
| Audit trail | Decision logged in Switch room Decisions tab |

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Switch Console API schema changes | Use switch-docs MCP in Antigravity for live schema reference |
| `sqlite3` native module build failure | Run `npm install sqlite3 --build-from-source` |
| SSE connection drops | EventSource auto-reconnects; agents log reconnection attempts |
| Agents don't see Discord messages | Verify SWITCH_ROOM_ID matches the room ID in Switch Console, not the Discord channel ID |
| Test suite runs before API restarts | Restart `npm run start:api` after @antigravity-fixer patches `server.js` |

