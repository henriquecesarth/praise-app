import express from 'express';
import cors from 'cors';
import repertoireRoutes from './features/repertoire/repertoire.routes';
import smartChordRoutes from './features/smart_chords/smart_chord.routes';
import { errorHandler } from './middleware/error-handler';

const app = express();

// ─── Global Middleware ───────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ─── Health Check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'praise-backend', timestamp: new Date().toISOString() });
});

// ─── Diagnostic Endpoint ──────────────────────────────────────
app.get('/api/diag', (_req, res) => {
  const envConfig = {
    supabaseUrl_defined: !!process.env.SUPABASE_URL,
    supabaseUrl_length: (process.env.SUPABASE_URL || '').length,
    supabaseUrl_startsWith: (process.env.SUPABASE_URL || '').substring(0, 8),
    supabaseAnonKey_defined: !!process.env.SUPABASE_ANON_KEY,
    supabaseAnonKey_length: (process.env.SUPABASE_ANON_KEY || '').length,
    supabaseServiceRoleKey_defined: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseServiceRoleKey_length: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').length,
    defaultMinistryId: process.env.DEFAULT_MINISTRY_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  };
  res.json(envConfig);
});

// ─── Feature Routes ──────────────────────────────────────────
app.use('/api/v1/ministries/:ministryId', repertoireRoutes);
app.use('/api/v1/smart-chords', smartChordRoutes);

// ─── Error Handler (must be last) ───────────────────────────
app.use(errorHandler);

export default app;
