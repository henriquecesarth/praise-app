import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

let supabaseInstance: SupabaseClient | null = null;

class DummyWebSocket {
  addEventListener() {}
  removeEventListener() {}
}

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime: {
        websocket: DummyWebSocket as any,
      },
    });
  }
  return supabaseInstance;
}
