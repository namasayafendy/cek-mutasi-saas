"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export function DaftarForm() {
  const router = useRouter();
  const [namaBisnis, setNamaBisnis] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!agree) {
      setError("Anda harus menyetujui Syarat Layanan dan Kebijakan Privasi");
      return;
    }
    if (password.length < 8) {
      setError("Password minimal 8 karakter");
      return;
    }
    if (password !== confirmPassword) {
      setError("Konfirmasi password tidak sama");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { brand_name: namaBisnis },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Trigger auto-bikin account + team_member + settings via Postgres trigger
    if (data.user && !data.session) {
      // Email confirmation required
      setInfo(
        `Akun dibuat. Cek email ${email} untuk verifikasi sebelum login. ` +
          `Pastikan cek folder spam kalau tidak ketemu.`,
      );
      setLoading(false);
      return;
    }

    // Auto-confirmed (jika email confirmation di-disable di Supabase settings)
    if (data.session) {
      // Update brand_name di accounts (trigger sudah bikin row)
      if (namaBisnis.trim()) {
        await supabase
          .from("accounts")
          .update({ brand_name: namaBisnis.trim() })
          .eq("owner_user_id", data.user!.id);
      }
      router.replace("/dashboard");
      router.refresh();
      return;
    }

    setLoading(false);
  }

  return (
    <div className="card p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="nama-bisnis" className="block text-sm font-medium text-slate-700">
            Nama Bisnis
          </label>
          <input
            id="nama-bisnis"
            type="text"
            required
            value={namaBisnis}
            onChange={(e) => setNamaBisnis(e.target.value)}
            placeholder="Misal: Toko Sembako Pak Bambang"
            className="input-base mt-1"
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-base mt-1"
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
            className="input-base mt-1"
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700">
            Konfirmasi Password
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input-base mt-1"
            disabled={loading}
          />
        </div>
        <div className="flex items-start gap-2">
          <input
            id="agree"
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-1"
            disabled={loading}
          />
          <label htmlFor="agree" className="text-xs text-slate-600">
            Saya setuju dengan{" "}
            <Link href="/tos" className="text-slate-900 hover:underline">
              Syarat Layanan
            </Link>{" "}
            dan{" "}
            <Link href="/privacy" className="text-slate-900 hover:underline">
              Kebijakan Privasi
            </Link>
          </label>
        </div>
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-700">
            {info}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Memproses..." : "Daftar — Mulai Trial 7 Hari"}
        </button>
      </form>
    </div>
  );
}
