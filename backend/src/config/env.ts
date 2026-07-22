import dotenv from 'dotenv';
dotenv.config();

function sanitizeSupabaseUrl(url?: string): string {
  if (!url) return '';
  return url.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
}

export const env = {
  supabaseUrl: sanitizeSupabaseUrl(process.env.SUPABASE_URL),
  // Suporte à nova nomenclatura de chaves do Supabase (Publishable Key e Secret Key) com fallback retrocompatível
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  defaultMinistryId: process.env.DEFAULT_MINISTRY_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
};
