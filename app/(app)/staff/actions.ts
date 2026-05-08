"use server";

// Server actions untuk staff management. Semua action di-gate dengan
// requireOwner() supaya staff tidak bisa invite/remove orang lain.

import { revalidatePath } from "next/cache";
import { getAccountContext } from "@/lib/supabase/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Invite staff via email. Pakai Supabase admin invite — kirim magic link
 * untuk verifikasi & set password pertama.
 *
 * Flow:
 * 1. Owner submit email
 * 2. Server cek role owner
 * 3. Cek apakah email udah pernah ada di auth.users
 *    - Kalau sudah ada → cek apakah sudah jadi member di account ini
 *      - Kalau ya → error "sudah anggota"
 *      - Kalau belum → tambah team_member.role=staff (multi-account belum di-support, jadi error)
 *    - Kalau belum ada → invite dengan service role API
 * 4. Auto-create team_member dengan role=staff & invited_at sekarang
 *    (signup trigger di DB tidak akan jalan karena email_confirmed belum ada — kita insert manual)
 */
export async function inviteStaff(email: string): Promise<ActionResult> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, error: "Tidak terauthentikasi" };
  if (ctx.member.role !== "owner") {
    return { ok: false, error: "Hanya owner yang bisa invite staff" };
  }

  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "Format email tidak valid" };
  }

  const admin = createAdminClient();

  // 1. Cek apakah email sudah ada di auth.users
  const { data: usersList, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) {
    return { ok: false, error: `Gagal cek user: ${listErr.message}` };
  }
  const existingUser = usersList?.users?.find(
    (u) => u.email?.toLowerCase() === trimmed,
  );

  if (existingUser) {
    // Cek apakah user ini sudah jadi member di account
    const { data: existingMember } = await admin
      .from("team_members")
      .select("id, account_id, role")
      .eq("user_id", existingUser.id)
      .maybeSingle();

    if (existingMember) {
      if (existingMember.account_id === ctx.account.id) {
        return { ok: false, error: "Email ini sudah jadi anggota tim Anda" };
      }
      return {
        ok: false,
        error:
          "Email ini sudah pakai aplikasi di akun lain. Multi-account belum di-support. Pakai email berbeda.",
      };
    }

    // User exists tapi belum punya team_member → langsung tambah
    const { error: insertErr } = await admin.from("team_members").insert({
      account_id: ctx.account.id,
      user_id: existingUser.id,
      role: "staff",
      invited_at: new Date().toISOString(),
      joined_at: new Date().toISOString(),
    });
    if (insertErr) return { ok: false, error: insertErr.message };

    await admin.from("audit_logs").insert({
      account_id: ctx.account.id,
      user_id: ctx.user.id,
      action: "staff.invited",
      target_type: "team_member",
      target_id: existingUser.id,
      metadata: { email: trimmed, mode: "existing_user" },
    });

    revalidatePath("/staff");
    return { ok: true };
  }

  // 2. Email belum ada → kirim invite. Supabase invite akan kirim email magic-link.
  // Signup trigger di DB akan baca raw_user_meta_data.invited_to_account_id dan
  // auto-create team_member dengan role=staff (lihat migration 0003).
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    trimmed,
    {
      // Setelah klik link di email, redirect ke /set-password supaya user set password
      redirectTo: process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL}/set-password`
        : undefined,
      data: {
        invited_to_account_id: ctx.account.id,
        invited_by_user_id: ctx.user.id,
      },
    },
  );
  if (inviteErr || !invited?.user) {
    return { ok: false, error: `Gagal kirim invite: ${inviteErr?.message ?? "unknown"}` };
  }

  // 3. Sanity check: pastikan trigger ber-jalan. Kalau team_member tidak ke-create
  //    (misal metadata tidak ke-passing), fallback ke manual insert.
  const { data: createdMember } = await admin
    .from("team_members")
    .select("id, account_id")
    .eq("user_id", invited.user.id)
    .maybeSingle();

  if (!createdMember) {
    const { error: tmErr } = await admin.from("team_members").insert({
      account_id: ctx.account.id,
      user_id: invited.user.id,
      role: "staff",
      invited_at: new Date().toISOString(),
      joined_at: null,
    });
    if (tmErr) {
      await admin.auth.admin.deleteUser(invited.user.id);
      return { ok: false, error: `Gagal link staff: ${tmErr.message}` };
    }
  } else if (createdMember.account_id !== ctx.account.id) {
    // Trigger malah link ke account lain — fix ke account inviter
    await admin
      .from("team_members")
      .update({ account_id: ctx.account.id, role: "staff" })
      .eq("user_id", invited.user.id);
  }

  await admin.from("audit_logs").insert({
    account_id: ctx.account.id,
    user_id: ctx.user.id,
    action: "staff.invited",
    target_type: "team_member",
    target_id: invited.user.id,
    metadata: { email: trimmed, mode: "new_user" },
  });

  revalidatePath("/staff");
  return { ok: true };
}

/** Remove staff dari account (tidak hapus auth.users — biar bisa di-invite ulang). */
export async function removeStaff(memberId: string): Promise<ActionResult> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, error: "Tidak terauthentikasi" };
  if (ctx.member.role !== "owner") {
    return { ok: false, error: "Hanya owner yang bisa remove staff" };
  }

  // Pastikan member ini di account yang sama (RLS sudah cover, tapi double-check)
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("team_members")
    .select("id, account_id, user_id, role")
    .eq("id", memberId)
    .maybeSingle();

  if (!member) return { ok: false, error: "Staff tidak ditemukan" };
  if (member.account_id !== ctx.account.id) {
    return { ok: false, error: "Akses ditolak" };
  }
  if (member.role === "owner") {
    return { ok: false, error: "Tidak bisa remove owner" };
  }

  const { error } = await supabase.from("team_members").delete().eq("id", memberId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_logs").insert({
    account_id: ctx.account.id,
    user_id: ctx.user.id,
    action: "staff.removed",
    target_type: "team_member",
    target_id: member.user_id,
  });

  revalidatePath("/staff");
  return { ok: true };
}

/** Resend invite (pakai magic link Supabase). Kalau user sudah set password, kirim password reset. */
export async function resendInvite(memberId: string): Promise<ActionResult> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, error: "Tidak terauthentikasi" };
  if (ctx.member.role !== "owner") {
    return { ok: false, error: "Hanya owner yang bisa resend invite" };
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("team_members")
    .select("id, account_id, user_id, joined_at")
    .eq("id", memberId)
    .maybeSingle();

  if (!member) return { ok: false, error: "Staff tidak ditemukan" };
  if (member.account_id !== ctx.account.id) {
    return { ok: false, error: "Akses ditolak" };
  }

  const { data: userRes } = await admin.auth.admin.getUserById(member.user_id);
  const targetEmail = userRes?.user?.email;
  if (!targetEmail) return { ok: false, error: "Email staff tidak ditemukan" };

  if (member.joined_at) {
    // Sudah aktif — kirim password reset
    const { error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: targetEmail,
      options: {
        redirectTo: process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL}/set-password`
        : undefined,
      },
    });
    if (error) return { ok: false, error: error.message };
  } else {
    // Belum accept — kirim invite ulang
    const { error } = await admin.auth.admin.inviteUserByEmail(targetEmail, {
      redirectTo: process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL}/set-password`
        : undefined,
    });
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}
