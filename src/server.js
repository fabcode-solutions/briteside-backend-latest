import 'dotenv/config';
import { loadSecrets, startRotationWatcher } from './config/secrets.js';
import { bootstrap as bootstrapUrlModeration } from './services/urlModeration/scheduler.js';

await loadSecrets();
const { refreshPool } = await import('./db/index.js');
if (process.env.NODE_ENV === 'production') {
  startRotationWatcher(refreshPool);
}

await bootstrapUrlModeration();

const { default: http } = await import('http');
const { default: setupSocketServer } = await import('./socket/index.js');
const { default: app } = await import('./app.js');
const { initializeCronJobs } = await import('./cron/cronJobs.js');
const { initPgBoss } = await import('./lib/pgboss.js');
const { initImportWorker } = await import('./workers/importWorker.js');
const { initModerationWorker } = await import('./workers/moderationWorker.js');
const { initUrlModerationSyncWorker } = await import('./workers/urlModerationSyncWorker.js');
const { initAnalyticsWorker } = await import('./workers/analyticsWorker.js');

const PORT = process.env.PORT || 3330;

// Create HTTP server from Express app
const server = http.createServer(app);

// Setup Socket.IO with namespaces for chat and event chat
const io = setupSocketServer(server);
app.set('io', io);

// Initialize pg-boss before cron — avoids event loop blockage during cron registration
await initPgBoss();
await initImportWorker();
await initModerationWorker();
await initUrlModerationSyncWorker();
await initAnalyticsWorker();

// Initialize cron jobs after async work is done
initializeCronJobs();

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/api-docs`);
});
