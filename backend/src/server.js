import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- 第一步：立即加载环境变量 ---
const envPaths = [
  join(__dirname, '../../.env'),
  join(__dirname, '../.env'),
  join(process.cwd(), '.env')
];

let envPathFound = false;
for (const p of envPaths) {
  const result = dotenv.config({ path: p });
  if (!result.error) {
    console.log(`✅ Loaded .env from: ${p}`);
    envPathFound = true;
    break;
  }
}

import express from 'express';
import cors from 'cors';
import theatersRoutes from './routes/theaters.js';
import bookingsRoutes from './routes/bookings.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/upload.js';
import { validateAdminKey } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

if (!process.env.ADMIN_SECRET_KEY) {
  console.error('❌ CRITICAL WARNING: ADMIN_SECRET_KEY is NOT set!');
}

app.use(cors({
  origin: function (origin, callback) {
    callback(null, true);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-Admin-Key', 'X-User-Code'],
  optionsSuccessStatus: 200
}));
app.use(express.json());

// 健康检查（最优先，不依赖数据库）
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.4',
    env: process.env.NODE_ENV
  });
});

// 懒加载数据库和同步服务（只在第一次请求时才初始化，避免冷启动超时）
let dbReady = null;
let syncService = null;

async function ensureDatabase() {
  if (!dbReady) {
    const { initializeDatabase } = await import('./db/init.js');
    await initializeDatabase();
    dbReady = true;
  }
}

async function ensureSyncService() {
  if (!syncService) {
    const { syncDatabaseFromSheet } = await import('./services/dbSyncService.js');
    syncService = syncDatabaseFromSheet;

    if (process.env.NODE_ENV !== 'production') {
      try {
        await syncService();
      } catch (e) {
        console.warn('首次同步失败（可忽略）', e.message);
      }
      setInterval(syncService, 60 * 1000);
    }
  }
  return syncService;
}

// ─── 公开配置接口 ─────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    await ensureDatabase();
    const { allAsync } = await import('./db/init.js');
    const rows = await allAsync('SELECT key, value FROM config');
    const config = {};
    for (const row of rows) config[row.key] = row.value;
    res.json({ success: true, data: config });
  } catch (err) {
    console.error('Config error:', err);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ─── 定时同步触发接口（适用于 GitHub Action / Vercel Cron） ─────────────────────────
app.post('/api/sync', validateAdminKey, async (req, res) => {
  try {
    await ensureDatabase();
    const { syncDatabaseFromSheet } = await import('./services/dbSyncService.js');
    const status = await syncDatabaseFromSheet();
    res.json({ success: true, data: status });
  } catch (err) {
    console.error('Cron sync failed:', err);
    res.status(500).json({ error: 'Sync failed', message: err.message });
  }
});

// ─── 同步状态查询 ───────────────────────────────────────────
app.get('/api/sync-status', validateAdminKey, async (req, res) => {
  try {
    const { getDbSyncStatus } = await import('./services/dbSyncService.js');
    res.json({ success: true, data: getDbSyncStatus() });
  } catch (err) {
    console.error('Sync status failed:', err);
    res.status(500).json({ error: 'Failed to fetch sync status', message: err.message });
  }
});

// ─── 路由（带懒加载初始化）────────────────────────────────
app.use('/api/theaters', async (req, res, next) => {
  await ensureDatabase();
  if (process.env.NODE_ENV !== 'production') await ensureSyncService();
  next();
}, theatersRoutes);

app.use('/api/bookings', async (req, res, next) => {
  await ensureDatabase();
  next();
}, bookingsRoutes);

app.use('/api/admin', async (req, res, next) => {
  await ensureDatabase();
  if (process.env.NODE_ENV !== 'production') await ensureSyncService();
  next();
}, adminRoutes);

app.use('/api/upload', async (req, res, next) => {
  await ensureDatabase();
  next();
}, uploadRoutes);

// 根路径
app.get('/', (req, res) => {
  res.json({ message: 'Seat Booking Backend API is running.', status: 'ok' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// 本地开发模式启动
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, async () => {
    console.log(`🎬 Booking Server running at http://localhost:${PORT}`);
    console.log(`📝 Frontend URL: ${FRONTEND_URL}`);
    await ensureDatabase();
    await ensureSyncService();
  });
}

export default app;
