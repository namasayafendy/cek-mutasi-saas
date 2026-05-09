// Batch lookup email auth.users untuk avoid N+1 calls.
// Pakai listUsers() paginated (1000/page) — di-call sekali per request,
// hasilnya filter by user_id yang dibutuhkan.

import type { SupabaseClient } from "@supabase/supabase-js";

const PER_PAGE = 1000;
const MAX_PAGES = 100; // safety cap: 100k users

/**
 * Fetch email untuk daftar user_id. Pakai listUsers paginated, build map.
 * Hanya pull halaman sampai semua wanted ID ketemu (early exit).
 */
export async function fetchUserEmails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userIds: string[],
): Promise<Map<string, string>> {
  const wanted = new Set(userIds);
  const result = new Map<string, string>();
  if (wanted.size === 0) return result;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error || !data?.users) break;
    for (const u of data.users) {
      if (wanted.has(u.id) && u.email) {
        result.set(u.id, u.email);
        if (result.size === wanted.size) return result; // semua udah ketemu
      }
    }
    if (data.users.length < PER_PAGE) break; // last page
  }
  return result;
}

/**
 * Find user by email address. Pakai listUsers paginated — fix bug listUsers default
 * cuma return 50 user pertama. Returns user object (id, email, dll) or null.
 */
export async function findUserByEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  email: string,
): Promise<{ id: string; email: string | undefined } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error || !data?.users) return null;
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return { id: found.id, email: found.email };
    if (data.users.length < PER_PAGE) return null; // last page, not found
  }
  return null;
}
