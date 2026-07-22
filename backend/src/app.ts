import express from 'express';
import cors from 'cors';
import repertoireRoutes from './features/repertoire/repertoire.routes';
import smartChordRoutes from './features/smart_chords/smart_chord.routes';
import groupRoutes from './features/groups/group.routes';
import liturgyRoutes from './features/liturgies/liturgy.routes';
import authRoutes from './features/auth/auth.routes';
import { errorHandler } from './middleware/error-handler';
import { env } from './config/env';

const app = express();

// ─── Global Middleware ───────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Health Check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'praise-backend', timestamp: new Date().toISOString() });
});

// ─── Diagnostic Endpoint ──────────────────────────────────────
app.get('/api/diag', (_req, res) => {
  const envConfig = {
    supabaseUrl_defined: !!env.supabaseUrl,
    supabaseUrl_length: (env.supabaseUrl || '').length,
    supabasePublishableKey_defined: !!env.supabasePublishableKey,
    supabasePublishableKey_length: (env.supabasePublishableKey || '').length,
    supabaseSecretKey_defined: !!env.supabaseSecretKey,
    supabaseSecretKey_length: (env.supabaseSecretKey || '').length,
    defaultMinistryId: env.defaultMinistryId,
  };
  res.json(envConfig);
});

// ─── Feature Routes ──────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/groups', groupRoutes);
app.use('/api/v1/groups/:groupId/liturgies', liturgyRoutes);
app.use('/api/v1/ministries/:ministryId/liturgies', liturgyRoutes);
app.use('/api/v1/groups/:groupId', repertoireRoutes);
app.use('/api/v1/ministries/:ministryId', repertoireRoutes);
app.use('/api/v1/smart-chords', smartChordRoutes);

// ─── Error Handler (must be last) ───────────────────────────
app.use(errorHandler);

export default app;
