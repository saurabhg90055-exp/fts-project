🛡️ PayGuard Switch
Autonomous FinTech Incident War-Room powered by Switch AI, Antigravity, and custom Node.js agents.

PayGuard Switch simulates a real-world payment incident where duplicate customer charges occur because of missing idempotency protection. Autonomous agents investigate the issue, generate a fix, validate compliance, require human approval, and record the deployment decision.

🎯 Problem Statement
Payment systems often retry requests during network failures.

Without idempotency protection, the same payment request can be processed more than once, resulting in duplicate customer charges.

PayGuard Switch demonstrates how autonomous agents can:

Detect incidents
Investigate databases
Enforce security rules
Validate fixes
Require human approval
Record deployment decisions
✨ Features
✅ Duplicate payment detection

✅ Automated incident trigger

✅ SQL forensics investigation

✅ PII masking for compliance

✅ Security scanner for secrets and tokens

✅ Idempotency bug repair workflow

✅ Git-based hotfix workflow

✅ Human approval gate

✅ Decision audit logging

✅ Real-time room collaboration

🏗️ Architecture
                     Customer Alert
                            |
                            v
                 +-------------------+
                 |  Trigger Script   |
                 +-------------------+
                            |
                            v
                 +-------------------+
                 | SQL Forensics     |
                 | Agent             |
                 +-------------------+
                            |
                            v
                 +-------------------+
                 | Switch Tasks      |
                 +-------------------+
                            |
                            v
                 +-------------------+
                 | Fix Agent         |
                 | (Antigravity)     |
                 +-------------------+
                            |
                            v
                 +-------------------+
                 | Release Gatekeeper|
                 +-------------------+
                            |
                            v
                      Human Approval
                            |
                            v
                 +-------------------+
                 | Deployment        |
                 +-------------------+
                            |
                            v
                 +-------------------+
                 | Decisions Log     |
                 +-------------------+
📁 Project Structure
payguard-switch/
│
├── agents/
│   ├── sql-forensics.js
│   └── release-gate.js
│
├── payment-service/
│   ├── server.js
│   ├── test.js
│   └── trigger-alert.js
│
├── docs/
│   ├── architecture.md
│   └── demo-script.md
│
├── fintech-war-room.template.yaml
├── .env.example
├── package.json
├── README.md
└── PRD.md
🚀 Quick Start
Install Dependencies
npm install
Start Payment API
npm run start:api
Start SQL Forensics Agent
npm run start:forensics
Start Release Gatekeeper
npm run start:gatekeeper
Trigger an Incident
npm run trigger
🧪 Running Tests
npm test
Expected:

Results: 7 passed, 0 failed
🔥 Incident Workflow
Step 1
Trigger script sends duplicate payment requests.

npm run trigger
Step 2
SQL Forensics agent:

Queries payments.db
Detects duplicate transactions
Masks customer card information
Generates incident report
Step 3
Fix agent investigates the issue and patches:

payment-service/server.js
Step 4
Release Gatekeeper:

Runs security scan
Checks for secrets/tokens
Runs CI tests
Step 5
Human approves deployment:

Approved
Step 6
Decision is permanently recorded.

🔑 Root Cause & Fix
Root Cause
The payment API inserted a new transaction for every request without checking whether the same:

idempotency_key
already existed.

This caused duplicate charges when requests were retried.

Fix
Before inserting:

SELECT id, status
FROM transactions
WHERE idempotency_key = ?
If a matching transaction already exists:

return existing transaction
Otherwise:

INSERT new transaction
Result:

✅ No duplicate charges

✅ Consistent responses

✅ All tests passing

🛡️ Security Features
PII Protection
Customer card numbers are masked before being posted to the room.

Example:

****-****-****-3344
Security Scanner
The Release Gatekeeper scans patches for:

Card numbers
Email addresses
Tokens
API keys
Secrets
Unsafe patches are rejected before tests run.

✅ Current Results
Idempotency Verification
Results: 7 passed, 0 failed
Trigger Automation
✅ Duplicate prevented
Security Scanner
✅ Email Detection
✅ Card Number Detection
✅ Secret Detection
✅ Token Detection
🎬 Demo Workflow
Run:
npm run trigger
Duplicate payment incident detected

SQL Forensics report generated

Task created

Fix patch reviewed

Security scan executed

CI tests executed

Human types:

Approved
Deployment confirmed

Decision recorded

🌐 Environment Variables
Variable	Description
SWITCH_URL	Switch Server URL
SWITCH_ROOM_ID	Room Identifier
SQL_AGENT_TOKEN	SQL Forensics Agent Token
GATE_AGENT_TOKEN	Release Gatekeeper Token
👥 Contributors
Anikha Padala
Team Members
Built for the Flip the Switch Hackathon 2026 🚀

📜 License
MIT License