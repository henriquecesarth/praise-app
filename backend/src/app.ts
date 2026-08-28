import express from 'express';
import cors from 'cors';
import repertoireRoutes from './features/repertoire/repertoire.routes';
import smartChordRoutes from './features/smart_chords/smart_chord.routes';
import ministryRoutes from './features/ministries/ministry.routes';
import liturgyRoutes from './features/liturgies/liturgy.routes';
import scheduleRoutes from './features/schedules/schedule.routes';
import authRoutes from './features/auth/auth.routes';
import teamRoutes from './features/teams/team.routes';
import roleRoutes from './features/roles/role.routes';
import classificationRoutes from './features/classifications/classification.routes';
import templateRoutes from './features/templates/template.routes';
import subscriptionRoutes from './features/subscriptions/subscription.routes';
import { errorHandler } from './middleware/error-handler';
import { config } from './config/unifiedConfig';

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
  res.json({
    port: config.port,
    nodeEnv: config.nodeEnv,
    firebaseProjectId: config.firebase.projectId || 'dev',
    defaultMinistryId: config.defaultMinistryId,
  });
});

// ─── Feature Routes ──────────────────────────────────────────
app.use('/api/v1', subscriptionRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/ministries', ministryRoutes);
app.use('/api/v1/groups', ministryRoutes); // Alias
app.use('/api/v1/ministries/:ministryId/liturgies', liturgyRoutes);
app.use('/api/v1/groups/:groupId/liturgies', liturgyRoutes);
app.use('/api/v1/ministries/:ministryId/schedules', scheduleRoutes);
app.use('/api/v1/groups/:groupId/schedules', scheduleRoutes);
app.use('/api/v1/ministries/:ministryId/teams', teamRoutes);
app.use('/api/v1/groups/:groupId/teams', teamRoutes);
app.use('/api/v1/ministries/:ministryId/roles', roleRoutes);
app.use('/api/v1/groups/:groupId/roles', roleRoutes);
app.use('/api/v1/ministries/:ministryId/classifications', classificationRoutes);
app.use('/api/v1/groups/:groupId/classifications', classificationRoutes);
app.use('/api/v1/ministries/:ministryId/schedule-templates', templateRoutes);
app.use('/api/v1/groups/:groupId/schedule-templates', templateRoutes);
app.use('/api/v1/ministries/:ministryId', repertoireRoutes);
app.use('/api/v1/groups/:groupId', repertoireRoutes);
app.use('/api/v1/smart-chords', smartChordRoutes);

// ─── Error Handler (must be last) ───────────────────────────
app.use(errorHandler);

export default app;
