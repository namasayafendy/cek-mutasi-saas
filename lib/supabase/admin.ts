// Service role admin client — UNTUK SERVER-SIDE ONLY (server actions / route handlers).
// JANGAN PERNAH import di client component karena service role bypass RLS.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Pakai generic <any, any, any> supaya .from(...).insert() tidak ke-infer 'never'
// tanpa harus generate Database type lengkap. RLS sudah handle keamanan di DB level.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, any, any>;

let cached: AdminClient | null = null;

export function createAdminClient(): AdminClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE service role env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  cached = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}
