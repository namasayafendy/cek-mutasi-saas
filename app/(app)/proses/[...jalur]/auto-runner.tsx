"use client";

// ============================================================
// KANAL MASUK MUTASI — Pelari otomatis (Fase 1)
// File: app/(app)/proses/[...jalur]/auto-runner.tsx
//
// Jalan sendiri begitu halaman terbuka. Tidak ada satu tombol pun di jalur
// bahagia — itu memang tujuannya: memangkas 11 langkah jadi 2 (kirim + ketuk).
//
// KENAPA PARSE TETAP DI BROWSER, BUKAN DI SERVER: parser PDF memakai pdfjs
// yang butuh window (lib/pdf/pdf-loader.ts berhenti kalau tidak ada window).
// Memindahkannya ke server berarti menulis ulang jalur pembaca uang — risiko
// besar untuk masalah yang bukan penyebabnya. Server di sini hanya kurir byte;
// yang membaca dan menulis mutasi tetap browser owner yang login, lewat RLS.
// Konsekuensi jujurnya: halaman ini harus tetap terbuka ±1 menit.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { prosesSatuBank } from "@/lib/pipeline/prosesSatuBank";
import { jalankanPass, type HasilPass } from "@/lib/pipeline/jalankanPass";
import { catatLangkah, kunciKirim, lepasKunci, tandaiSelesai, tandaiGagal } from "./actions";
import { catatCakupan } from "@/lib/coverage/actions";
import type { Bank, Outlet, MatchRulePreset } from "@/lib/types";

type Tahap = { teks: string; keadaan: "jalan" | "selesai" | "gagal" | "ragu" };

export function AutoRunner({
  jobId,
  namaFile,
  urlBerkas,
  bank,
  outlets,
  rules,
  accountId,
  userId,
  gadaiSyncEnabled,
}: {
  jobId: string;
  namaFile: string;
  urlBerkas: string;
  bank: Bank;
  outlets: Outlet[];
  rules: MatchRulePreset[];
  accountId: string;
  userId: string;
  gadaiSyncEnabled: boolean;
}) {
  const [tahap, setTahap] = useState<Tahap[]>([]);
  const [selesai, setSelesai] = useState(false);
  const [laporan, setLaporan] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const sudahJalan = useRef(false);

  useEffect(() => {
    // Penjaga pertama terhadap React StrictMode (dev menjalankan efek dua kali).
    // Penjaga yang SEBENARNYA ada di DB: kunciKirim() — ref ini tidak berlaku
    // lintas tab maupun lintas HP.
    if (sudahJalan.current) return;
    sudahJalan.current = true;

    let wakeLock: any = null;
    // Dicatat DI LUAR try: kalau ada lemparan di tahap DEBET, catch harus tahu
    // bahwa KREDIT sudah mendarat di Aceh Gadai. Tanpa ini laporannya berbunyi
    // "gagal total" padahal buku sudah berubah — kebohongan yang paling mahal,
    // karena ia mendorong orang mengulang dari awal.
    const sudahTerkirim: string[] = [];
    const mulai = async () => {
      const dorong = (teks: string, keadaan: Tahap["keadaan"] = "jalan") =>
        setTahap((t) => [...t.map((x) => (x.keadaan === "jalan" ? { ...x, keadaan: "selesai" as const } : x)), { teks, keadaan }]);
      const ubahTerakhir = (keadaan: Tahap["keadaan"]) =>
        setTahap((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, keadaan } : x)));

      try {
        // Layar tetap menyala — parse + simpan 1.200 baris bisa 1-3 menit dan
        // Chrome Android membekukan tab latar.
        try {
          wakeLock = await (navigator as any).wakeLock?.request("screen");
        } catch {
          /* tidak wajib */
        }

        if (!gadaiSyncEnabled) {
          throw new Error("Integrasi Aceh Gadai belum diaktifkan di akun ini.");
        }

        // ── 1. Ambil berkas ──
        dorong("Mengambil berkas…");
        await catatLangkah(jobId, "unduh");
        const res = await fetch(urlBerkas);
        if (!res.ok) throw new Error(`Gagal mengunduh berkas (HTTP ${res.status})`);
        const blob = await res.blob();
        const nl = namaFile.toLowerCase();
        const mime = nl.endsWith(".html") || nl.endsWith(".htm") ? "text/html" : "application/pdf";
        // Dibungkus ulang jadi File supaya identik dengan yang datang dari
        // <input type="file"> — parser hanya membaca byte-nya (file.arrayBuffer).
        const file = new File([blob], namaFile, { type: mime });

        // ── 2. Baca + simpan ──
        dorong("Membaca mutasi…");
        await catatLangkah(jobId, "parse");
        const supabase = createClient();
        const hasilBaca = await prosesSatuBank({
          supabase,
          accountId,
          bank,
          file,
          jenis: "kredit",
          // Tidak ada yang melihat layar PDF di sini; melewatinya menghemat
          // ratusan MB memori di HP dan tidak menyentuh hasil parse sedikit pun.
          renderHalaman: false,
          // Berkas berisi kredit saja (atau debet saja) BUKAN kegagalan di sini —
          // dua pass dijalankan dari satu berkas yang sama.
          gagalKalauJenisKosong: false,
          onLangkah: (t) => setTahap((x) => [...x.slice(0, -1), { teks: t, keadaan: "jalan" }]),
        });
        if (!hasilBaca.ok) throw new Error(hasilBaca.alasan);
        const up = hasilBaca.upload;
        ubahTerakhir("selesai");
        await catatLangkah(jobId, "parse-ok");

        const ig = up.integrity;

        // Catat cakupan SEBELUM pass mana pun. Kalau dicatat belakangan dan
        // salah satu pass gagal, rentang ini hilang dan tanggalnya akan
        // tampak seperti tidak pernah diperiksa selamanya.
        if (ig?.firstDate && ig?.lastDate) {
          await catatCakupan({
            bankId: bank.id,
            tglAwal: ig.firstDate,
            tglAkhir: ig.lastDate,
            saldoAwal: ig.saldoAwal,
            saldoAkhir: ig.saldoAkhir,
            complete: ig.complete,
            chainBreaks: ig.chainBreaks,
            connected: ig.connected,
            jobId,
            sumber: "telegram",
          });
        }

        const ringkasBerkas = {
          namaFile,
          bankLabel: bank.label || bank.kode || "Rekening",
          barisTerbaca: up.persistInfo.total,
          barisBaru: up.persistInfo.newCount,
          barisSudahAda: up.persistInfo.dupCount,
          utuh: ig?.complete ?? null,
          nyambung: ig?.connected ?? null,
          selisihSambungan: ig?.gapAmount ?? 0,
          rantaiPutus: ig?.chainBreaks ?? 0,
          sampaiTanggal: ig?.lastDate ?? null,
        };

        // ── 3. PASS 1 KREDIT (uang masuk) ──
        // Kredit didahulukan karena vonisnya punya jalur RECHECK yang menunda;
        // debet vonisnya terminal, jadi ditaruh belakangan.
        dorong("Mencocokkan transfer MASUK…");
        await catatLangkah(jobId, "kredit");
        const hasilKredit = await jalankanPass({
          supabase, accountId, userId, jenis: "kredit", upload: up, outlets, rules,
          onLangkah: (t) => setTahap((x) => [...x.slice(0, -1), { teks: t, keadaan: "jalan" }]),
          kunciKirim: async () => (await kunciKirim(jobId, "kredit")).ok,
          lepasKunci: async () => { await lepasKunci(jobId, "kredit"); },
        });
        if (hasilKredit.terkirim) sudahTerkirim.push("kredit");
        ubahTerakhir(hasilKredit.batal ? "ragu" : "selesai");

        // ── 4. PASS 2 DEBET (uang keluar) ──
        dorong("Mencocokkan transfer KELUAR…");
        await catatLangkah(jobId, "debet");
        const hasilDebet = await jalankanPass({
          supabase, accountId, userId, jenis: "debet", upload: up, outlets, rules,
          onLangkah: (t) => setTahap((x) => [...x.slice(0, -1), { teks: t, keadaan: "jalan" }]),
          kunciKirim: async () => (await kunciKirim(jobId, "debet")).ok,
          lepasKunci: async () => { await lepasKunci(jobId, "debet"); },
        });
        if (hasilDebet.terkirim) sudahTerkirim.push("debet");
        ubahTerakhir(hasilDebet.batal ? "ragu" : "selesai");

        // ── 5. Laporkan ──
        dorong("Mengirim laporan ke Telegram…");
        const bersih = (h: HasilPass) => ({
          jenis: h.jenis as "kredit" | "debet",
          periodStart: h.periodStart, periodEnd: h.periodEnd,
          klaimDitarik: h.klaimDitarik, klaimDibuang: h.klaimDibuang,
          outletTakDikenal: h.outletTakDikenal,
          klaimDinilai: h.klaimDinilai, cocok: h.cocok, belumKetemu: h.belumKetemu,
          ditahanDiLuarPeriode: h.ditahanDiLuarPeriode,
          ditahanKonflik: h.ditahanKonflik,
          sudahTerbuktiSebelumnya: h.sudahTerbuktiSebelumnya,
          terkirim: h.terkirim, batal: h.batal,
          unclaimedCount: h.unclaimedCount, unclaimedTotal: h.unclaimedTotal,
        });
        const tutup = await tandaiSelesai(jobId, ringkasBerkas, [bersih(hasilKredit), bersih(hasilDebet)]);
        ubahTerakhir("selesai");
        setLaporan(tutup.teks ?? null);
        setSelesai(true);
      } catch (e) {
        const pesan = e instanceof Error ? e.message : String(e);
        setTahap((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, keadaan: "gagal" } : x)));
        // tandaiGagal sendiri bisa gagal (jaringan mati, sesi kedaluwarsa).
        // Kalau lemparannya dibiarkan, galat ASLI ikut hilang dan tidak ada
        // yang pernah tahu — persis kegagalan senyap yang dihindari di
        // seluruh berkas ini. Jadi jangan pernah menjanjikan "sudah dikabarkan"
        // kecuali memang berhasil.
        let terkabar = false;
        try {
          terkabar = (await tandaiGagal(jobId, pesan, sudahTerkirim)).ok;
        } catch (e2) {
          console.error("[auto-runner] tandaiGagal ikut gagal:", e2);
        }
        const tambahan = sudahTerkirim.length
          ? ` Hasil ${sudahTerkirim.join(" & ")} SUDAH terkirim ke Aceh Gadai — jangan ulang dari awal tanpa memeriksa.`
          : "";
        setGalat(pesan + tambahan + (terkabar ? "" : " (dan gagal mengabari Telegram — tugas ini perlu diurus manual)"));
      } finally {
        try {
          await wakeLock?.release();
        } catch {
          /* abaikan */
        }
      }
    };

    void mulai();
    // Sengaja dijalankan sekali saja: seluruh bekal datang dari server component
    // dan tidak berubah selama halaman hidup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Proses Mutasi</h1>
        <p className="mt-1 text-sm text-slate-600">
          {namaFile} · {bank.label}
        </p>
      </div>

      {!selesai && !galat && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Jangan pindah aplikasi dulu — biarkan layar ini terbuka sampai selesai (±1 menit).
        </div>
      )}

      <div className="card p-5">
        <ol className="space-y-2.5">
          {tahap.map((t, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              {t.keadaan === "jalan" && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-slate-400" />}
              {t.keadaan === "selesai" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
              {t.keadaan === "ragu" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
              {t.keadaan === "gagal" && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
              <span className={t.keadaan === "gagal" ? "text-red-700" : "text-slate-700"}>{t.teks}</span>
            </li>
          ))}
        </ol>
      </div>

      {galat && (
        <div className="card p-5 border-red-200 bg-red-50">
          <h2 className="font-medium text-red-900">Gagal</h2>
          <p className="mt-1 text-sm text-red-800">{galat}</p>
          <p className="mt-2 text-xs text-red-700">
            Mengulang aman untuk bagian yang belum terkirim: baris yang sudah tersimpan
            tidak akan digandakan, dan pass yang sudah mendarat tidak akan dikirim dua kali.
          </p>
        </div>
      )}

      {laporan && (
        <div className="card p-5">
          <h2 className="font-medium text-slate-900">Laporan</h2>
          <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{laporan}</pre>
        </div>
      )}
    </div>
  );
}
