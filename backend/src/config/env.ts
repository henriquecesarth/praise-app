import dotenv from 'dotenv';
dotenv.config();

export const env = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  defaultMinistryId: process.env.DEFAULT_MINISTRY_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
};
