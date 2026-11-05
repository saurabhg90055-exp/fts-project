/**
 * payment-service/test.js
 * Automated idempotency verification test suite.
 * Run with: node payment-service/test.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:4000';
let passed = 0;
let failed = 0;

function postCharge(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: '/api/v1/charge',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: JSON.parse(data) });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}${detail ? ' → ' + detail : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('  PayGuard Idempotency Test Suite');
  console.log('========================================\n');

  const idempotencyKey = `idem_test_${Date.now()}`;
  const payload = {
    user_email: 'test@example.com',
    card_last4: '****-****-****-9999',
    amount: 1000,
    idempotency_key: idempotencyKey,
  };

  // Test 1: First charge succeeds
  console.log('Test 1: First charge should succeed with 201...');
  const res1 = await postCharge(payload);
  assert('Status is 201', res1.status === 201, `Got ${res1.status}`);
  assert('Has transaction_id', typeof res1.body.transaction_id === 'number');
  assert('Status is CAPTURED', res1.body.status === 'CAPTURED');
  const firstTxId = res1.body.transaction_id;

  // Test 2: Retry with same idempotency_key must NOT create a duplicate
  console.log('\nTest 2: Retry with same idempotency_key must return same transaction (idempotent)...');
  const res2 = await postCharge(payload);
  assert('Status is 200 or 201', res2.status === 200 || res2.status === 201, `Got ${res2.status}`);
  assert(
    'Same transaction_id returned (no duplicate)',
    res2.body.transaction_id === firstTxId,
    `Expected ${firstTxId}, Got ${res2.body.transaction_id}`
  );

  // Test 3: Different key creates new transaction
  console.log('\nTest 3: Different idempotency_key creates a new transaction...');
  const res3 = await postCharge({ ...payload, idempotency_key: `idem_test_${Date.now()}_new` });
  assert('Status is 201', res3.status === 201, `Got ${res3.status}`);
  assert(
    'Different transaction_id',
    res3.body.transaction_id !== firstTxId,
    `Expected different from ${firstTxId}, Got ${res3.body.transaction_id}`
  );

  console.log('\n========================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err.message);
  console.error('Make sure the payment API is running on port 4000.');
  process.exit(1);
});

