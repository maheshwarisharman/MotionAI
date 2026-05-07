/**
 * Supabase client singleton.
 *
 * Imported by database.service.ts — do not use directly elsewhere.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

let _client: SupabaseClient | null = null;

/**
 * Returns the shared Supabase client, creating it once on first call.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return _client;
}
