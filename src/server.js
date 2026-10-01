import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/error.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()), credentials: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 200 }));

// Simple health check - no dependencies
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Comprehensive health check with API endpoint tests
app.get('/health/apis', async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const startTime = Date.now();

  const apiTests = [
    { name: 'health', method: 'GET', path: '/health', expectedStatus: 200 },
    { name: 'auth-login', method: 'POST', path: '/api/auth/login', body: { email: 'test@test.com', password: 'wrong' }, expectedStatus: [401, 500] },
    { name: 'auth-register', method: 'POST', path: '/api/auth/register', body: { name: 'Test', email: 'test@test.com', password: 'short' }, expectedStatus: 400 },
    { name: 'auth-me', method: 'GET', path: '/api/auth/me', expectedStatus: 401 },
    { name: 'profile', method: 'GET', path: '/api/profile', expectedStatus: 401 },
    { name: 'dashboard', method: 'GET', path: '/api/dashboard', expectedStatus: 401 },
    { name: 'loans-list', method: 'GET', path: '/api/loans', expectedStatus: 401 },
    { name: 'loan-products', method: 'GET', path: '/api/loan-products', expectedStatus: 401 },
    { name: 'collaterals', method: 'GET', path: '/api/collaterals', expectedStatus: 401 },
    { name: 'notifications', method: 'GET', path: '/api/notifications', expectedStatus: 401 },
    { name: 'repayments', method: 'GET', path: '/api/repayments', expectedStatus: 401 },
    { name: 'admin-dashboard', method: 'GET', path: '/api/admin/dashboard', expectedStatus: 401 },
    { name: 'admin-users', method: 'GET', path: '/api/admin/users', expectedStatus: 401 },
  ];

  const results = await Promise.all(apiTests.map(async (test) => {
    const testStart = Date.now();
    try {
      const response = await fetch(`${baseUrl}${test.path}`, {
        method: test.method,
        headers: {
          'Content-Type': 'application/json',
        },
        ...(test.body ? { body: JSON.stringify(test.body) } : {}),
      });
      const duration = Date.now() - testStart;
      const expectedStatuses = Array.isArray(test.expectedStatus) ? test.expectedStatus : [test.expectedStatus];
      const passed = expectedStatuses.includes(response.status);
      return {
        name: test.name,
        path: test.path,
        method: test.method,
        status: response.status,
        expectedStatus: test.expectedStatus,
        passed,
        durationMs: duration,
        error: passed ? null : `Expected ${JSON.stringify(test.expectedStatus)}, got ${response.status}`,
      };
    } catch (err) {
      return {
        name: test.name,
        path: test.path,
        method: test.method,
        status: 0,
        expectedStatus: test.expectedStatus,
        passed: false,
        durationMs: Date.now() - testStart,
        error: err.message,
      };
    }
  }));

  const allPassed = results.every(r => r.passed);
  const totalDuration = Date.now() - startTime;

  res.status(allPassed ? 200 : 503).json({
    status: allPassed ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    totalDurationMs: totalDuration,
    checks: results,
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
    },
  });
});

app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

if (process.env.NODE_ENV !== 'production') app.listen(env.PORT, () => console.log(`API listening on ${env.PORT}`));
export default app;