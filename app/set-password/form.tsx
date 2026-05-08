"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export default function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  // Tunggu Supabase parse hash fragment dari magic-link supaya session aktif
  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        setAuthReady(true);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session) setAuthReady(true);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password minimal 8 karakter");
      return;
    }
    if (password !== confirm) {
      setError("Password & konfirmasi tidak sama");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Update last_active_at + joined_at di team_members
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      await supabase
        .from("team_members")
        .update({
          joined_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
        })
        .eq("user_id", userData.user.id)
        .is("joined_at", null);
    }
    setSuccess(true);
    setLoading(false);
    setTimeout(() => router.push("/dashboard"), 1500);
  }

  if (success) {
    return (
      <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-800 flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          Password berhasil di-set. Mengarahkan ke dashboard…
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="text-sm text-slate-600 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Menunggu verifikasi link invite…
        <p className="text-xs text-slate-500 mt-2">
          Pastikan Anda buka halaman ini dari link di email. Kalau tidak ada link aktif, minta
          owner kirim ulang invite.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-sm font-medium text-slate-700">Password baru</label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mt-1"
          disabled={loading}
          autoFocus
        />
        <p className="text-xs text-slate-500 mt-1">Minimal 8 karakter.</p>
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700">Konfirmasi password</label>
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="input mt-1"
          disabled={loading}
        />
      </div>
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
          </>
        ) : (
          "Set Password"
        )}
      </button>
    </form>
  );
}
