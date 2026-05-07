/**
 * Supabase client singleton.
 *
 * Imported by database.service.ts — do not use directly elsewhere.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

let _adminClient: SupabaseClient | null = null;
let _authClient: SupabaseClient | null = null;

/**
 * Returns the shared Supabase client, creating it once on first call.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false },
      },
    );
  }
  return _adminClient;
}

/**
 * Returns a client used only for validating incoming Supabase bearer tokens.
 */
export function getSupabaseAuthClient(): SupabaseClient {
  if (!_authClient) {
    _authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return _authClient;
}
