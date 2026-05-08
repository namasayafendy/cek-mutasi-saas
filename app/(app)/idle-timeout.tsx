"use client";

// Auto-logout setelah idle. Listen ke user activity, kalau tidak ada aktivitas
// > IDLE_LIMIT_MS, logout otomatis. Warning muncul WARNING_BEFORE_MS sebelum logout.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Clock, Loader2 } from "lucide-react";

const IDLE_LIMIT_MS = 60 * 60 * 1000; // 1 jam
const WARNING_BEFORE_MS = 5 * 60 * 1000; // warning 5 menit sebelum logout
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"] as const;

export function IdleTimeout() {
  const router = useRouter();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_BEFORE_MS / 1000);
  const lastActivityRef = useRef<number>(Date.now());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    function recordActivity() {
      lastActivityRef.current = Date.now();
      if (showWarning) setShowWarning(false);
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, recordActivity, { passive: true });
    }
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, recordActivity);
      }
    };
  }, [showWarning]);

  useEffect(() => {
    async function doLogout() {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      try {
        const supabase = createClient();
        await supabase.auth.signOut();
      } catch (e) {
        console.error("Auto-logout error:", e);
      }
      router.replace("/login?reason=idle");
    }

    tickerRef.current = setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      const remaining = IDLE_LIMIT_MS - idleFor;

      if (remaining <= 0) {
        if (tickerRef.current) clearInterval(tickerRef.current);
        doLogout();
        return;
      }

      if (remaining <= WARNING_BEFORE_MS) {
        setShowWarning(true);
        setSecondsLeft(Math.max(0, Math.ceil(remaining / 1000)));
      } else if (showWarning) {
        setShowWarning(false);
      }
    }, 1000);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [router, showWarning]);

  function stayLoggedIn() {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
  }

  if (!showWarning) return null;

  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  const display = `${mm}:${ss.toString().padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-amber-600" />
          <h3 className="font-semibold text-slate-900">Sesi akan berakhir</h3>
        </div>
        <p className="text-sm text-slate-600">
          Anda akan otomatis di-logout dalam{" "}
          <strong className="text-slate-900 font-mono">{display}</strong> karena tidak ada
          aktivitas. Klik tombol di bawah untuk tetap login.
        </p>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              const supabase = createClient();
              supabase.auth.signOut().finally(() => router.replace("/login"));
            }}
            className="btn-secondary text-sm flex-1"
          >
            Logout sekarang
          </button>
          <button
            type="button"
            onClick={stayLoggedIn}
            className="btn-primary text-sm flex-1"
          >
            <Loader2 className="h-4 w-4" />
            Tetap login
          </button>
        </div>
      </div>
    </div>
  );
}
