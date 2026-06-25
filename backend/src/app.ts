import express from 'express';
import cors from 'cors';
import repertoireRoutes from './features/repertoire/repertoire.routes';
import { errorHandler } from './middleware/error-handler';

const app = express();

// ─── Global Middleware ───────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Health Check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'praise-backend', timestamp: new Date().toISOString() });
});

// ─── Feature Routes ──────────────────────────────────────────
app.use('/api/v1/ministries/:ministryId', repertoireRoutes);

// ─── Error Handler (must be last) ───────────────────────────
app.use(errorHandler);

export default app;
