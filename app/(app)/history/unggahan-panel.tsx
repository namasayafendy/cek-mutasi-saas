"use client";

// Daftar unggahan terakhir satu rekening + tombol "Batalkan unggahan"
// (Tahap 1, Okt 2026). Logika & otorisasinya ada di server
// (lib/unggahan/actions.ts → fungsi DB batalkan_unggahan); komponen ini hanya
// menampilkan dan meminta konfirmasi. Tombol hanya muncul untuk unggahan
// TERAKHIR yang belum dibatalkan, dan hanya bagi pemilik.

import { useEffect, useState } from "react";
import { Loader2, Undo2, Upload } from "lucide-react";
import { daftarUnggahan, batalkanUnggahan, type RingkasUnggahan } from "@/lib/unggahan/actions";
import { formatDateID, parseDateISO } from "@/lib/format";

function waktuWib(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tgl(iso: string | null): string {
  if (!iso) return "-";
  const d = parseDateISO(iso);
  return d ? formatDateID(d) : iso;
}

export function UnggahanPanel({ bankId, onBerubah }: { bankId: string; onBerubah?: () => void }) {
  const [daftar, setDaftar] = useState<RingkasUnggahan[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);
  const [proses, setProses] = useState<string | null>(null);

  // Dinaikkan untuk memuat ulang daftar. Semua setState terjadi SESUDAH
  // await (bukan langsung di badan efek), dan jawaban yang datang sesudah
  // rekening berganti dibuang (`aktif`).
  const [putaran, setPutaran] = useState(0);
  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const r = await daftarUnggahan(bankId, 8);
        if (!aktif) return;
        if (r.ok) setDaftar(r.daftar);
        else setGalat(r.error);
      } catch (e) {
        if (aktif) setGalat(`Gagal memuat unggahan: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (aktif) setMemuat(false);
      }
    })();
    return () => {
      aktif = false;
    };
  }, [bankId, putaran]);

  function muat() {
    setMemuat(true);
    setPutaran((n) => n + 1);
  }

  async function batal(u: RingkasUnggahan) {
    const yakin = window.confirm(
      `Batalkan unggahan ${u.fileName ?? ""} (${waktuWib(u.createdAt)})?\n\n` +
        `• ${u.barisMilik ?? u.barisBaru} baris yang masuk lewat unggahan ini akan DIHAPUS.\n` +
        `• Titik saldo terakhir rekening dikembalikan ke sebelum unggahan ini — bila belum digeser unggahan lain.\n` +
        `• Cakupan tanggal dari unggahan ini dihapus.\n\n` +
        `Vonis yang SUDAH terkirim ke Aceh Gadai TIDAK ikut dibatalkan.\n` +
        `Kalau ada baris yang sudah dipakai pencocokan, pembatalan ditolak utuh.`,
    );
    if (!yakin) return;
    setProses(u.id);
    setGalat(null);
    setKabar(null);
    let r: Awaited<ReturnType<typeof batalkanUnggahan>>;
    try {
      r = await batalkanUnggahan(u.id);
    } catch (e) {
      // Tidak tahu apakah fungsi database sempat jalan — tampilkan keadaan nyata.
      setGalat(`Pembatalan tidak terkonfirmasi: ${e instanceof Error ? e.message : String(e)}. Daftar dimuat ulang.`);
      muat();
      return;
    } finally {
      setProses(null);
    }
    if (!r.ok) {
      setGalat(r.error);
      muat();
      return;
    }
    const recon =
      r.recon === "dikembalikan"
        ? "titik saldo dikembalikan"
        : r.recon === "sudah_berubah_lagi"
          ? "titik saldo TIDAK diubah (sudah digeser unggahan lain)"
          : "titik saldo tidak berubah";
    setKabar(`Unggahan dibatalkan: ${r.barisDihapus} baris dihapus, ${r.cakupanDihapus} cakupan dihapus, ${recon}.`);
    muat();
    onBerubah?.();
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <Upload className="h-4 w-4 text-slate-500" />
        <h2 className="font-medium text-slate-900 text-sm">Unggahan terakhir</h2>
        <span className="text-xs text-slate-500">— hanya unggahan paling akhir yang bisa dibatalkan</span>
      </div>
      {galat && <div className="px-4 py-2 text-sm text-red-800 bg-red-50 border-b border-red-200">{galat}</div>}
      {kabar && <div className="px-4 py-2 text-sm text-emerald-800 bg-emerald-50 border-b border-emerald-200">{kabar}</div>}
      {memuat ? (
        <div className="p-4 text-sm text-slate-500 inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat unggahan...
        </div>
      ) : daftar.length === 0 ? (
        <div className="p-4 text-sm text-slate-500">Belum ada unggahan tercatat untuk rekening ini.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr className="text-xs uppercase text-slate-500">
                <th className="px-3 py-2 text-left font-semibold">Waktu</th>
                <th className="px-3 py-2 text-left font-semibold">Berkas</th>
                <th className="px-3 py-2 text-left font-semibold">Periode</th>
                <th className="px-3 py-2 text-right font-semibold">Baris</th>
                <th className="px-3 py-2 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((u) => (
                <tr key={u.id} className={`border-b border-slate-100 ${u.dibatalkanAt ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {waktuWib(u.createdAt)}
                    <div className="text-xs text-slate-500">{u.sumber === "telegram" ? "Telegram" : "Manual"}</div>
                  </td>
                  <td className="px-3 py-2 max-w-[220px] truncate" title={u.fileName ?? ""}>
                    {u.fileName ?? "-"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {tgl(u.periodeAwal)} – {tgl(u.periodeAkhir)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {u.barisTerbaca} dibaca
                    <div className="text-xs text-slate-500">
                      {u.status === "selesai"
                        ? `${u.barisBaru} baru`
                        : u.barisMilik != null
                          ? `${u.barisMilik} baru`
                          : "baru: belum tercatat"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {u.dibatalkanAt ? (
                      <span className="text-xs text-slate-500">Dibatalkan {waktuWib(u.dibatalkanAt)}</span>
                    ) : u.status === "berjalan" ? (
                      <span className="text-xs text-amber-700">Sedang diproses…</span>
                    ) : u.status === "terhenti" && !u.bolehBatal ? (
                      <span className="text-xs text-slate-500">Terhenti (tidak selesai)</span>
                    ) : u.bolehBatal ? (
                      <button
                        type="button"
                        onClick={() => batal(u)}
                        disabled={proses !== null}
                        className="text-xs inline-flex items-center gap-1.5 text-red-700 hover:text-red-900 disabled:opacity-50 border border-red-200 hover:border-red-300 rounded-md px-2.5 py-1.5"
                      >
                        {proses === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                        Batalkan unggahan
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
