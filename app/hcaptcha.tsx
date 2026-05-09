"use client";

// Wrapper hCaptcha widget — load script + render widget + return token via callback.
// Tidak pakai @hcaptcha/react-hcaptcha package supaya tidak nambah dependency.

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    hcaptcha?: {
      render: (container: HTMLElement, opts: HCaptchaRenderOptions) => string;
      reset: (widgetId?: string) => void;
      execute: (widgetId?: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

type HCaptchaRenderOptions = {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  size?: "normal" | "compact" | "invisible";
  theme?: "light" | "dark";
};

const SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? "";
const SCRIPT_URL = "https://js.hcaptcha.com/1/api.js?render=explicit";
const SCRIPT_ID = "hcaptcha-script";

let scriptPromise: Promise<void> | null = null;

function loadHcaptchaScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.hcaptcha) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      // Wait for it
      const check = () => {
        if (window.hcaptcha) resolve();
        else setTimeout(check, 100);
      };
      check();
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const wait = () => {
        if (window.hcaptcha) resolve();
        else setTimeout(wait, 50);
      };
      wait();
    };
    script.onerror = () => reject(new Error("Failed to load hCaptcha script"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function HCaptcha({
  onVerify,
  onExpire,
}: {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) {
      setError("CAPTCHA belum di-setup (NEXT_PUBLIC_HCAPTCHA_SITE_KEY missing).");
      return;
    }
    let cancelled = false;
    loadHcaptchaScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.hcaptcha) return;
        if (widgetIdRef.current) return; // already rendered
        try {
          const id = window.hcaptcha.render(containerRef.current, {
            sitekey: SITE_KEY,
            callback: (token: string) => onVerify(token),
            "expired-callback": () => {
              if (onExpire) onExpire();
            },
            "error-callback": () => {
              setError("CAPTCHA error. Refresh dan coba lagi.");
            },
            size: "normal",
            theme: "light",
          });
          widgetIdRef.current = id;
        } catch (e) {
          // hCaptcha throws kalau widget sudah ke-render di elemen yang sama (StrictMode dev)
          console.warn("hCaptcha render error:", e);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
      // Clean up widget supaya tidak duplicate saat re-mount
      if (widgetIdRef.current && window.hcaptcha?.remove) {
        try {
          window.hcaptcha.remove(widgetIdRef.current);
        } catch {
          // Ignore
        }
        widgetIdRef.current = null;
      }
    };
    // onVerify / onExpire stable via useCallback di parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
        {error}
      </div>
    );
  }

  return <div ref={containerRef} className="flex justify-center" />;
}

/**
 * Helper untuk reset CAPTCHA programmatically (misal setelah login error,
 * widget jadi invalid dan harus di-reset).
 */
export function resetHcaptcha() {
  if (typeof window !== "undefined" && window.hcaptcha) {
    window.hcaptcha.reset();
  }
}
