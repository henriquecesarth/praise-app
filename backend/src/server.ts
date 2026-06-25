import app from './app';
import { env } from './config/env';

app.listen(env.port, () => {
  console.log(`🎵 Praise Backend running on http://localhost:${env.port}`);
  console.log(`   Environment: ${env.nodeEnv}`);
  console.log(`   Health check: http://localhost:${env.port}/api/health`);
});
