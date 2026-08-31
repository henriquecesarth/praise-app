import app from './app';
import { env } from './config/env';
import { billingReconcilerWorker } from './features/billing/billing-reconciler.worker';

const server = app.listen(env.port, () => {
  console.log(`🎵 Praise Backend running on http://localhost:${env.port}`);
  console.log(`   Environment: ${env.nodeEnv}`);
  console.log(`   Health check: http://localhost:${env.port}/api/health`);

  billingReconcilerWorker.start();
});

const gracefulShutdown = () => {
  billingReconcilerWorker.stop();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
