import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const keyToUse = env.supabaseSecretKey || env.supabasePublishableKey;
    supabaseInstance = createClient(env.supabaseUrl, keyToUse, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseInstance;
}
