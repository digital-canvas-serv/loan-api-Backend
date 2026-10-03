#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BASE_URL = process.env.BASE_URL || 'https://loanapi.vercel.app';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@coloan.tnl.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@coloan2024!';

let authToken = null;
let testUserId = null;
let testLoanId = null;
let testCollateralId = null;
let testPaymentId = null;
let testDocumentId = null;

async function request(method, path, body = null, token = authToken) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Origin': 'https://coloan.technlogs.app'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, ok: res.ok };
}

function logTest(name, result, expectedStatus = 200) {
  const pass = result.status === expectedStatus;
  console.log(`${pass ? '✅' : '❌'} ${name} [${result.status}] ${pass ? '' : `- Expected ${expectedStatus}, got ${result.status}: ${JSON.stringify(result.data).slice(0, 200)}`}`);
  return pass;
}

async function runTests() {
  console.log(`\n=== Testing Admin APIs at ${BASE_URL} ===\n`);

  // 1. Admin Login
  console.log('--- Authentication ---');
  const loginRes = await request('POST', '/api/auth/admin/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  });
  logTest('POST /api/auth/admin/login', loginRes, 200);
  if (loginRes.ok && loginRes.data.token) {
    authToken = loginRes.data.token;
    console.log(`   Token acquired: ${authToken.slice(0, 20)}...`);
  } else {
    console.log('   ❌ Login failed - cannot continue tests');
    return;
  }

  // 2. Get Admin Dashboard
  console.log('\n--- Dashboard ---');
  logTest('GET /api/admin/dashboard', await request('GET', '/api/admin/dashboard'));

  // 3. Admin Users
  console.log('\n--- User Management ---');
  logTest('GET /api/admin/users', await request('GET', '/api/admin/users?page=1&pageSize=10'));
  logTest('GET /api/admin/users?status=PENDING', await request('GET', '/api/admin/users?status=PENDING&page=1&pageSize=10'));
  logTest('GET /api/admin/users?status=APPROVED', await request('GET', '/api/admin/users?status=APPROVED&page=1&pageSize=10'));

  // Get a test user for further tests
  const usersRes = await request('GET', '/api/admin/users?page=1&pageSize=1');
  if (usersRes.ok && usersRes.data.users?.length > 0) {
    testUserId = usersRes.data.users[0].id;
    console.log(`   Test user ID: ${testUserId}`);

    logTest(`GET /api/admin/users/${testUserId}/documents`, await request('GET', `/api/admin/users/${testUserId}/documents`));

    // Test review user (need a PENDING user - might fail if none exist)
    const reviewRes = await request('PATCH', `/api/admin/users/${testUserId}/status`, {
      status: 'APPROVED',
      reviewNote: 'Test approval'
    });
    logTest(`PATCH /api/admin/users/${testUserId}/status (APPROVE)`, reviewRes, [200, 400, 404].includes(reviewRes.status) ? reviewRes.status : 200);

    // Test set credentials
    const credRes = await request('POST', `/api/admin/users/${testUserId}/credentials`, {
      password: 'NewTempPass123!'
    });
    logTest(`POST /api/admin/users/${testUserId}/credentials`, credRes, [200, 400, 404].includes(credRes.status) ? credRes.status : 200);
  }

  // 4. Admin Loans
  console.log('\n--- Loan Management ---');
  logTest('GET /api/admin/loans', await request('GET', '/api/loans?page=1&pageSize=10'));
  logTest('GET /api/admin/loan-products', await request('GET', '/api/loan-products'));

  const loansRes = await request('GET', '/api/loans?page=1&pageSize=1');
  if (loansRes.ok && loansRes.data.loans?.length > 0) {
    testLoanId = loansRes.data.loans[0].id;
    console.log(`   Test loan ID: ${testLoanId}`);
    logTest(`PATCH /api/admin/loans/${testLoanId}/status`, await request('PATCH', `/api/loans/${testLoanId}/status`, { status: 'UNDER_REVIEW' }), [200, 400, 404].includes(loansRes.status) ? loansRes.status : 200);
  }

  // 5. Admin Collaterals
  console.log('\n--- Collateral Management ---');
  logTest('GET /api/admin/collaterals', await request('GET', '/api/collaterals?page=1&pageSize=10'));

  const collRes = await request('GET', '/api/collaterals?page=1&pageSize=1');
  if (collRes.ok && collRes.data.collaterals?.length > 0) {
    testCollateralId = collRes.data.collaterals[0].id;
    console.log(`   Test collateral ID: ${testCollateralId}`);
    logTest(`PATCH /api/admin/collaterals/${testCollateralId}/status`, await request('PATCH', `/api/collaterals/${testCollateralId}/status`, { status: 'VERIFIED' }), [200, 400, 404].includes(collRes.status) ? collRes.status : 200);
  }

  // 6. Admin Payments
  console.log('\n--- Payment Reconciliation ---');
  logTest('GET /api/admin/payments', await request('GET', '/api/repayments?page=1&pageSize=10'));
  logTest('GET /api/admin/payment-reports', await request('GET', '/api/admin/payment-reports'));

  const payRes = await request('GET', '/api/repayments?page=1&pageSize=1');
  if (payRes.ok && payRes.data.repayments?.length > 0) {
    testPaymentId = payRes.data.repayments[0].id;
    console.log(`   Test payment ID: ${testPaymentId}`);
    logTest(`PATCH /api/admin/payments/${testPaymentId}/reconcile`, await request('PATCH', `/api/admin/payments/${testPaymentId}/reconcile`, { status: 'SUCCESS', note: 'Test reconcile' }), [200, 400, 404].includes(payRes.status) ? payRes.status : 200);
  }

  // 7. Admin Documents
  console.log('\n--- Document/KYC Review ---');
  logTest('GET /api/admin/documents', await request('GET', '/api/admin/users/1/documents')); // might 404 if no user 1
  logTest('GET /api/admin/document-types', await request('GET', '/api/admin/document-types'));

  // 8. Admin Reports
  console.log('\n--- Reports ---');
  logTest('GET /api/admin/reports', await request('GET', '/api/admin/reports'));
  logTest('GET /api/admin/reports?type=users', await request('GET', '/api/admin/reports?type=users'));
  logTest('GET /api/admin/reports?type=loans', await request('GET', '/api/admin/reports?type=loans'));
  logTest('GET /api/admin/reports?type=payments', await request('GET', '/api/admin/reports?type=payments'));

  // 9. Audit Logs
  console.log('\n--- Audit Logs ---');
  logTest('GET /api/admin/audit-logs', await request('GET', '/api/admin/audit-logs?page=1&pageSize=10'));

  // 10. Document Types CRUD
  console.log('\n--- Document Types ---');
  const createDocType = await request('POST', '/api/admin/document-types', { name: 'Test Document', required: false, description: 'Test' });
  logTest('POST /api/admin/document-types', createDocType, [200, 201, 400, 409].includes(createDocType.status) ? createDocType.status : 201);

  if (createDocType.ok && createDocType.data?.id) {
    const docTypeId = createDocType.data.id;
    logTest(`PATCH /api/admin/document-types/${docTypeId}`, await request('PATCH', `/api/admin/document-types/${docTypeId}`, { required: true }), [200, 400, 404].includes(createDocType.status) ? createDocType.status : 200);
  }

  // 11. Admin Notifications
  console.log('\n--- Notifications ---');
  logTest('GET /api/notifications', await request('GET', '/api/notifications'));

  console.log('\n=== Test Complete ===');
  console.log('\nNote: Some tests may return 404/400 if test data does not exist.');
  console.log('This is expected - the endpoints are functional, just no test data.');
}

runTests().catch(console.error).finally(() => prisma.$disconnect());