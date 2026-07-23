import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

function sanitizePrivateKey(key?: string): string {
  if (!key) return '';
  // Trata quebras de linha em chaves privadas PEM vindas de variáveis de ambiente
  return key.replace(/\\n/g, '\n');
}

const configSchema = z.object({
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  jwtSecret: z.string().default('praise-app-jwt-secret-key-change-in-production'),
  firebase: z.object({
    projectId: z.string().optional(),
    clientEmail: z.string().optional(),
    privateKey: z.string().optional(),
    databaseURL: z.string().optional(),
  }),
  defaultMinistryId: z.string().default('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
});

const rawConfig = {
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,
  jwtSecret: process.env.JWT_SECRET,
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: sanitizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  },
  defaultMinistryId: process.env.DEFAULT_MINISTRY_ID,
};

export const config = configSchema.parse(rawConfig);
