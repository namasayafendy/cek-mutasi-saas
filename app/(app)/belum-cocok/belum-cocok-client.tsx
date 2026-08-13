"use client";

// ============================================================
// CEKTRANSFER - Layar penutupan Lapis 2
// File: app/(app)/belum-cocok/belum-cocok-client.tsx
//
// Tiga hal yang bisa dilakukan pada resi yang tidak ketemu di rekening, dan
// ketiganya menyatakan hal yang BERBEDA tentang dunia nyata:
//
//   1. Cocokkan ke baris mutasi  -> uangnya ADA, mesinnya yang melewatkan
//   2. Batalkan (salah catat)    -> resinya TIDAK PERNAH ADA
//   3. Biarkan                   -> belum tahu; ia sengaja menagih lagi besok
//
// Yang TIDAK disediakan: tombol "tandai beres" tanpa menyebut sebab. Penutupan
// tanpa pernyataan adalah cara paling cepat membuat daftar ini bersih dan
// sekaligus tidak berarti apa-apa.
// ============================================================

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  ambilBelumCocok, cariKandidat, cocokkanManual, batalkanKlaim, terimaBuktiBeda,
  ambilDibatalkan, pulihkanPembatalan, type BarisDibatalkan,
  type BarisBelumCocok, type KandidatMutasi,
} from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tglID = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y.slice(2)}`;
};

export function BelumCocokClient() {
  const [items, setItems] = useState<BarisBelumCocok[]>([]);
  const [salahArah, setSalahArah] = useState(0);
  const [muat, setMuat] = useState(true);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [buka, setBuka] = useState<BarisBelumCocok | null>(null);
  const [kandidat, setKandidat] = useState<KandidatMutasi[] | null>(null);
  const [pilih, setPilih] = useState<KandidatMutasi | null>(null);
  /** Jadi true sesudah gadai memperingatkan "ini bukti terakhir". */
  const [sadarTerakhir, setSadarTerakhir] = useState(false);
  const [aksi, setAksi] = useState<"" | "COCOK" | "BATAL" | "TERIMA">("");
  const [cariLain, setCariLain] = useState("");
  const [cariTgl, setCariTgl] = useState("");
  const [catatan, setCatatan] = useState("");
  // Panel pemulihan pembatalan. Sengaja TERTUTUP secara bawaan: ini jalan
  // keluar darurat, bukan pekerjaan harian — kalau ia terbuka terus, daftar
  // yang benar-benar perlu dikerjakan jadi tenggelam di bawahnya.
  const [bukaPulih, setBukaPulih] = useState(false);
  const [dibatalkan, setDibatalkan] = useState<BarisDibatalkan[] | null>(null);
  const [muatPulih, setMuatPulih] = useState(false);
  const [pilihPulih, setPilihPulih] = useState<BarisDibatalkan | null>(null);
  const [catatanPulih, setCatatanPulih] = useState("");
  const [sadarDobel, setSadarDobel] = useState(false);
  const [sibuk, mulai] = useTransition();

  const segarkan = useCallback(async () => {
    setMuat(true); setError("");
    const r = await ambilBelumCocok();
    if (r.ok) { setItems(r.items); setSalahArah(r.salahArah); }
    else setError(r.msg);
    setMuat(false);
  }, []);

  useEffect(() => { void segarkan(); }, [segarkan]);

  function tutup() {
    setBuka(null); setKandidat(null); setPilih(null); setAksi(""); setCatatan(""); setSadarTerakhir(false);
  }

  async function bukaBaris(it: BarisBelumCocok) {
    setBuka(it); setKandidat(null); setPilih(null); setAksi(""); setCatatan(""); setError(""); setCariLain(""); setCariTgl(""); setSadarTerakhir(false);
    const r = await cariKandidat(it.tgl, it.nominal, it.arah ?? "KREDIT");
    if (r.ok) setKandidat(r.items);
    else { setKandidat([]); setError(r.msg); }
  }

  /** Cari ulang dengan nominal yang disebut sendiri — untuk satu transfer yang
   *  menutup beberapa permintaan sekaligus (mis. permintaan 4jt + 1jt yang
   *  ditransfer sekali 5jt). */
  /** Cari ulang dengan nominal DAN/ATAU tanggal yang disebut sendiri.
   *
   *  Tanggalnya perlu karena tanggal klaim adalah tanggal KONTRAK, sedangkan
   *  uangnya mendarat pada tanggal SLIP. SBR-1-0314: kontrak 1 Agustus, transfer
   *  26 Juli — jendela bawaan ±4 hari tidak akan pernah menjangkaunya, jadi
   *  pemilik melihat "tidak ada kandidat" untuk uang yang jelas ada. */
  async function cariUlang() {
    if (!buka) return;
    const n = Math.round(Number(cariLain.replace(/[^\d]/g, "") || 0));
    const t = /^\d{4}-\d{2}-\d{2}$/.test(cariTgl) ? cariTgl : undefined;
    if (!(n > 0) && !t) return;
    setKandidat(null); setPilih(null); setError("");
    const r = await cariKandidat(buka.tgl, buka.nominal, buka.arah ?? "KREDIT",
                                 n > 0 ? n : undefined, t);
    if (r.ok) setKandidat(r.items);
    else { setKandidat([]); setError(r.msg); }
  }

  function jalankan() {
    if (!buka) return;
    mulai(async () => {
      setError(""); setOkMsg("");
      const r = aksi === "BATAL"
        // sadarBuktiTerakhir dikirim hanya pada tekanan KEDUA. Gadai menolak
        // sekali dulu kalau ini resi terakhir kontraknya, supaya "buang resi
        // dobel" tidak diam-diam berubah jadi "cabut satu-satunya bukti".
        ? await batalkanKlaim(buka.klaim_id, catatan, sadarTerakhir)
        : aksi === "TERIMA"
          ? await terimaBuktiBeda(buka.klaim_id, catatan)
          // Baris yang dipilih IKUT dikirim. Tanpa ini penutupan hanya
          // menandai klaim di gadai sementara baris mutasinya tetap bebas —
          // di /history tertulis "belum match", dan yang lebih berbahaya:
          // baris itu masih bisa direbut klaim lain.
          : await cocokkanManual(buka.klaim_id, catatan, pilih?.id, buka.outlet);
      if (!r.ok) {
        setError(r.msg);
        // Peringatan bukti-terakhir: tekanan berikutnya berarti menegaskan.
        if ((r as any).buktiTerakhir === true) setSadarTerakhir(true);
      }
      else { setOkMsg(r.msg); tutup(); await segarkan(); }
    });
  }

  async function muatDibatalkan() {
    setMuatPulih(true); setError("");
    const r = await ambilDibatalkan(30);
    setMuatPulih(false);
    if (r.ok) setDibatalkan(r.items);
    else { setDibatalkan([]); setError(r.msg ?? "Gagal memuat daftar pembatalan."); }
  }

  function jalankanPulih(d: BarisDibatalkan) {
    mulai(async () => {
      setError(""); setOkMsg("");
      const r = await pulihkanPembatalan(d.klaimId, catatanPulih, sadarDobel);
      if (!r.ok) {
        setError(r.msg);
        // Peringatan dobel: tekanan berikutnya berarti menegaskan.
        if ((r as any).akanDobel === true) setSadarDobel(true);
        return;
      }
      setOkMsg(r.msg);
      setPilihPulih(null); setCatatanPulih(""); setSadarDobel(false);
      // Dua daftar disegarkan: yang dipulihkan kembali PENDING sehingga ia bisa
      // muncul lagi di daftar utama, dan ia harus hilang dari daftar pembatalan.
      await muatDibatalkan();
      await segarkan();
    });
  }

  const catatanCukup = catatan.trim().length >= 10;

  if (muat) return <div className="card p-6 text-center text-sm text-slate-500">Memuat…</div>;

  return (
    <div className="space-y-4">
      {okMsg && <div className="card border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">{okMsg}</div>}
      {error && <div className="card border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</div>}

      {salahArah > 0 && (
        <div className="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {salahArah} klaim lama berarah salah (transaksi uang KELUAR terlanjur dicatat
          sebagai klaim masuk). Ia tidak ditagihkan di sini karena tidak akan pernah bisa
          cocok — bukan uang hilang, hanya sisa cacat lama.
        </div>
      )}

      {!buka ? (
        <>
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-2xl font-semibold text-slate-900">{items.length}</div>
              <div className="text-sm text-slate-600">
                belum diselesaikan · {rp(items.reduce((s, x) => s + x.nominal, 0))}
              </div>
            </div>
            <button onClick={() => void segarkan()} className="btn-secondary text-sm">Muat ulang</button>
          </div>

          {items.length === 0 && (
            <div className="card p-6 text-center text-sm text-emerald-700">
              ✅ Tidak ada resi yang menggantung. Semua sudah ketemu di rekening atau sudah diselesaikan.
            </div>
          )}

          {items.map((it) => (
            <div key={it.klaim_id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={
                      "rounded px-1.5 py-0.5 text-[11px] font-medium " +
                      ((it.arah ?? "KREDIT") === "DEBET"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-sky-100 text-sky-700")
                    }>
                      {(it.arah ?? "KREDIT") === "DEBET" ? "uang KELUAR" : "uang MASUK"}
                    </span>
                    <span className="truncate font-medium text-slate-900">{it.no_faktur}</span>
                    {/* SEBAB, bukan cuma "belum cocok".
                        Daftar ini sekarang memuat TIGA keadaan yang menuntut
                        tindakan berbeda: uangnya belum ketemu, resinya dipakai
                        kontrak lain, atau ia kalah berebut baris dan tidak
                        pernah divonis. Tanpa penanda ini ketiganya terlihat
                        sama dan yang paling gawat tenggelam. */}
                    {it.status && it.status !== "UNMATCHED" && (
                      <span className={
                        "rounded px-1.5 py-0.5 text-[11px] font-medium " +
                        (it.status === "BUKTI_BEDA"
                          ? "bg-red-600 text-white"
                          : it.status === "DUPLIKAT"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-violet-100 text-violet-700")
                      }>
                        {it.status === "BUKTI_BEDA"
                          ? "⛔ bukti foto beda"
                          : it.status === "DUPLIKAT" ? "resi dobel" : "belum divonis"}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {it.outlet} · {tglID(it.tgl)} · {it.umur} hari menggantung
                  </div>
                  {it.sebab && (
                    <div className="mt-0.5 text-xs text-slate-400">{it.sebab}</div>
                  )}
                </div>
                <div className="shrink-0 text-right font-semibold text-slate-900">{rp(it.nominal)}</div>
              </div>
              <button onClick={() => void bukaBaris(it)} className="btn-primary mt-3 w-full text-sm">
                Periksa
              </button>
            </div>
          ))}

          {/* ── JALAN PULANG DARI PEMBATALAN ──
              Tombol "Batalkan (salah catat)" dulunya pintu satu arah: sekali
              ditekan, klaimnya lenyap dari daftar di atas — satu-satunya layar
              tempat ia pernah terlihat — jadi salah tekan berubah jadi keadaan
              permanen yang hanya bisa dibetulkan lewat SQL ke produksi.

              SBR-4-0182 (11 Agustus 2026) berakhir DIBATALKAN padahal
              catatannya sendiri berbunyi "Cocok ke baris mutasi … a.n. FAZDRIA":
              temuannya benar, statusnya yang keliru, dan tidak ada tombol yang
              bisa membetulkannya. Kontraknya nongkrong dua hari di Kotak Masuk
              sebagai "tidak ada slip" untuk uang yang jelas ada di rekening. */}
          <div className="card p-4">
            <button
              onClick={() => {
                const buka = !bukaPulih;
                setBukaPulih(buka);
                if (buka && dibatalkan === null) void muatDibatalkan();
              }}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-sm font-medium text-slate-700">
                Salah tekan &ldquo;Batalkan&rdquo;? Pulihkan di sini
              </span>
              <span className="text-xs text-slate-400">{bukaPulih ? "tutup" : "buka"}</span>
            </button>

            {bukaPulih && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <p className="mb-3 text-xs text-slate-500">
                  Pembatalan 30 hari terakhir. Memulihkan mengembalikan resinya ke
                  <b> PENDING</b> — bukan langsung dinyatakan cocok. Kalau uangnya memang
                  ada, ia akan cocok sendiri pada kiriman mutasi berikutnya.
                </p>

                {muatPulih && <p className="text-sm text-slate-500">Memuat…</p>}
                {!muatPulih && dibatalkan?.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Tidak ada pembatalan dalam 30 hari terakhir.
                  </p>
                )}

                {dibatalkan?.map((d) => (
                  <div key={d.klaimId} className="mb-2 rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{d.noFaktur}</div>
                        <div className="text-xs text-slate-500">
                          {d.outlet} · {d.arah === "DEBET" ? "uang KELUAR" : "uang MASUK"} ·{" "}
                          {tglID(d.tglTransaksi)}{d.jamTransfer ? ` ${d.jamTransfer}` : ""}
                        </div>
                        {d.catatan && (
                          <div className="mt-1 text-xs text-slate-400">{d.catatan}</div>
                        )}
                      </div>
                      <div className="shrink-0 text-right text-sm font-semibold text-slate-900">
                        {rp(d.nominal)}
                      </div>
                    </div>

                    {/* Transaksi yang sudah BATAL tidak punya kewajiban bank untuk
                        dibuktikan, jadi tombolnya TIDAK ditawarkan sama sekali —
                        tombol yang selalu gagal lebih buruk daripada tombol yang
                        tidak ada. */}
                    {/* Dua pembatalan bisa terlihat sama padahal artinya
                        berlawanan: yang satu mencabut bukti satu-satunya
                        (keliru), yang satu membuang resi DOBEL (benar).
                        Bedanya disebut di sini, sebelum tombolnya ditekan. */}
                    {d.akanDobel && (
                      <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
                        Transaksinya sudah punya bukti berlaku {rp(d.buktiHidup)} — sudah
                        menutupi kewajibannya {rp(d.bankWajib)}. Pembatalan ini kemungkinan
                        besar MEMANG benar (resi dobel); memulihkannya membuat buktinya
                        terbaca dua kali.
                      </p>
                    )}
                    {d.bolehPulih ? (
                      <button
                        onClick={() => { setPilihPulih(d); setCatatanPulih(""); setSadarDobel(false); }}
                        className="btn-secondary mt-2 w-full text-sm"
                      >
                        Batalkan pembatalan
                      </button>
                    ) : (
                      <p className="mt-2 text-xs text-amber-700">
                        Transaksinya sudah BATAL — resinya tidak perlu dipulihkan.
                        Kalau transaksinya yang salah dibatalkan, betulkan transaksinya dulu.
                      </p>
                    )}

                    {pilihPulih?.klaimId === d.klaimId && (
                      <div className="mt-2 rounded-lg bg-slate-50 p-2">
                        <textarea
                          value={catatanPulih}
                          onChange={(e) => setCatatanPulih(e.target.value)}
                          rows={2}
                          placeholder="Kenapa pembatalannya keliru?"
                          className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                        />
                        <div className="mt-1 text-xs text-slate-400">
                          {catatanPulih.trim().length}/10 huruf minimum
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => setPilihPulih(null)} className="btn-secondary flex-1 text-sm">
                            Tutup
                          </button>
                          <button
                            onClick={() => void jalankanPulih(d)}
                            disabled={sibuk || catatanPulih.trim().length < 10}
                            className="btn-primary flex-1 text-sm disabled:opacity-40"
                          >
                            {sibuk ? "Menyimpan…" : "Pulihkan"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <button onClick={tutup} className="btn-secondary text-sm">← Kembali</button>

          <div className="card p-4">
            <div className="font-medium text-slate-900">{buka.no_faktur}</div>
            <div className="mt-1 text-xs text-slate-500">
              {buka.outlet} · {tglID(buka.tgl)} ·{" "}
              {(buka.arah ?? "KREDIT") === "DEBET" ? "uang KELUAR" : "uang MASUK"}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{rp(buka.nominal)}</div>
            <p className="mt-2 text-xs text-slate-600">
              Dicari di mutasi rekening dan tidak ditemukan. Itu belum tentu berarti uangnya
              tidak ada — periksa dulu baris calon di bawah.
            </p>
          </div>

          {/* ── Baris calon ──
              Inilah bagian yang menjawab kebingungan paling sering: barisnya
              ADA di rekening, tapi sudah dipegang input lain, sehingga klaim
              ini tidak kebagian. Tanpa menyebut pemegangnya, pemilik hanya
              melihat "tidak ditemukan" dan menyimpulkan uangnya hilang. */}
          <div className="card p-4">
            <div className="mb-2 font-medium text-slate-900">
              Baris mutasi yang mungkin cocok {kandidat ? `(${kandidat.length})` : ""}
            </div>
            {kandidat === null && <div className="text-sm text-slate-500">Mencari…</div>}
            {kandidat?.length === 0 && (
              <p className="text-sm text-slate-600">
                Tidak ada baris mutasi bernominal sekitar segini pada rentang tanggalnya.
                Kalau menurut Bapak uangnya memang tidak pernah keluar/masuk, gunakan
                <b> Batalkan</b>. Kalau uangnya seharusnya ada, jangan ditutup — biarkan
                menagih sampai jelas.
              </p>
            )}
            {/* ── Cari nominal lain ──
                Satu transfer bisa menutup BEBERAPA permintaan: kasir membuat
                permintaan 4jt lalu 1jt, tapi mentransfernya sekali 5jt. Klaim
                4jt tidak akan pernah menemukan baris 5jt lewat pencarian
                bawaan, dan tanpa jalan ini penutupan yang benar mustahil —
                yang tersisa cuma menuliskan sesuatu yang salah. */}
            <div className="mb-3 space-y-2 rounded-lg bg-slate-50 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-600">Cari nominal lain:</span>
                <input
                  value={cariLain}
                  onChange={(e) => setCariLain(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void cariUlang(); }}
                  placeholder="mis. 5000000"
                  inputMode="numeric"
                  className="w-36 rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
              {/* TANGGAL SLIP, bukan tanggal kontrak. Keduanya bisa berjauhan:
                  SBR-1-0314 ditutup 1 Agustus tapi konsumennya transfer 26 Juli,
                  dan jendela bawaan ±4 hari tidak akan pernah menjangkaunya. */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-600">Cari tanggal lain:</span>
                <input
                  type="date"
                  value={cariTgl}
                  onChange={(e) => setCariTgl(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button onClick={() => void cariUlang()} className="btn-secondary text-xs">Cari</button>
                {(cariLain || cariTgl) && (
                  <button
                    onClick={() => { setCariLain(""); setCariTgl(""); void bukaBaris(buka); }}
                    className="text-xs text-slate-500 underline"
                  >
                    kembali ke bawaan
                  </button>
                )}
              </div>
              {cariTgl && (
                <div className="text-[11px] text-slate-500">
                  Dicari di {tglID(cariTgl)} ±1 hari — pakai tanggal yang tertulis di SLIP,
                  bukan tanggal kontraknya.
                </div>
              )}
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Pakai ini kalau satu transfer menutup beberapa permintaan sekaligus —
              tutup tiap permintaannya satu per satu ke baris yang sama, dan sebutkan
              itu di catatannya.
            </p>

            {kandidat?.map((k) => (
              <label
                key={k.id}
                className={
                  "mb-2 block cursor-pointer rounded-lg border p-3 text-sm " +
                  (pilih?.id === k.id ? "border-slate-900 bg-slate-50" : "border-slate-200")
                }
              >
                <input
                  type="radio" name="kandidat" className="mr-2"
                  checked={pilih?.id === k.id}
                  onChange={() => {
                    setPilih(k);
                    setCatatan(
                      `Cocok ke baris mutasi ${tglID(k.tgl)} ${k.jam} ${rp(k.nominal)}` +
                      (k.pihak ? ` a.n. ${k.pihak}` : "") +
                      (k.no_ref ? ` ref ${k.no_ref}` : "") +
                      (k.dipegang && !k.dipegang.dariGadai
                        ? " — barisnya sudah dipegang input ketikan manual"
                        : ""),
                    );
                  }}
                />
                <span className="font-medium text-slate-900">{rp(k.nominal)}</span>{" "}
                <span className="text-slate-600">
                  {tglID(k.tgl)} {k.jam}
                  {k.pihak ? ` · ${k.pihak}` : ""}
                </span>
                {k.no_ref && <div className="ml-6 truncate text-xs text-slate-400">{k.no_ref}</div>}
                {k.nominal !== buka.nominal && (
                  <div className="ml-6 text-xs text-amber-700">
                    beda {rp(Math.abs(k.nominal - buka.nominal))} dari nilai resi — biasanya biaya admin
                  </div>
                )}
                {k.dipegang && (
                  <div className={"ml-6 text-xs " + (k.dipegang.dariGadai ? "text-red-700" : "text-amber-700")}>
                    {k.dipegang.dariGadai
                      ? `⚠️ sudah dipakai klaim gadai ${k.dipegang.klaimPemegang ?? "lain"} (cara: ${k.dipegang.caraCocok}) — periksa dulu apakah klaim itu memang berhak atas baris ini`
                      : `sudah dipegang input ketikan manual (tanggal input ${tglID(k.dipegang.tanggalInput)}, ${rp(k.dipegang.nominalInput)}, cara: ${k.dipegang.caraCocok}) — inilah sebab klaim ini tidak kebagian`}
                  </div>
                )}
              </label>
            ))}
          </div>

          {aksi === "" ? (
            <div className="space-y-2">
              {/* BUKTI FOTO BEDA punya pertanyaan yang BERBEDA, jadi tombolnya
                  juga berbeda. Untuk baris ini uangnya BIASANYA sudah ketemu di
                  rekening — yang dipertanyakan cuma fotonya. Tanpa tombol ini
                  baris seperti SJB-2-0085 muncul selamanya tanpa satu pun cara
                  menutupnya, dan daftar yang tak bisa dituntaskan berhenti dibaca. */}
              {buka.status === "BUKTI_BEDA" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs text-amber-900">
                    {buka.status_asli === "MATCHED"
                      ? "Uangnya SUDAH ketemu di rekening. Yang dipertanyakan hanya fotonya:"
                      : "Yang dipertanyakan di sini adalah fotonya:"}{" "}
                    <span className="font-medium">{buka.sebab}</span>
                  </div>
                  <button
                    onClick={() => { setAksi("TERIMA"); setCatatan(""); }}
                    className="btn-secondary mt-2 w-full text-sm"
                  >
                    ✓ Sudah saya periksa — anggap beres
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setAksi("COCOK")}
                  disabled={!pilih}
                  className="btn-primary flex-1 text-sm disabled:opacity-40"
                >
                  ✓ Cocokkan ke baris terpilih
                </button>
                <button onClick={() => { setAksi("BATAL"); setCatatan(""); }} className="btn-secondary flex-1 text-sm">
                  Batalkan (salah catat)
                </button>
              </div>
            </div>
          ) : (
            <div className="card p-4">
              <div className="mb-2 font-medium text-slate-900">
                {aksi === "BATAL" ? "Batalkan — resi ini tidak pernah ada"
                 : aksi === "TERIMA" ? "Sudah saya periksa — bukti fotonya wajar"
                 : "Cocokkan manual"}
              </div>
              <p className="mb-3 text-xs text-slate-600">
                {aksi === "BATAL"
                  ? "Pakai ini HANYA kalau resinya memang salah catat: salah ketik, AI membaca slip hantu, atau tercatat dua kali. JANGAN dipakai untuk resi yang benar ada tapi tidak ketemu — itu tuduhan uang hilang, dan membatalkannya menghapus pertanyaannya, bukan menjawabnya. Klaimnya tidak dihapus, hanya dicabut daya buktinya, dan transaksinya bisa kembali terbuka di Lapis 1."
                  : aksi === "TERIMA"
                  ? "Ini TIDAK mengubah apa pun tentang uangnya — vonis fotonya tetap tercatat apa adanya selamanya. Yang Bapak nyatakan hanya: sudah diperiksa dan wajar, jadi berhenti ditagihkan. Alasannya disimpan bersama nama dan waktunya. Kalau uangnya sendiri BELUM ketemu di rekening, Aceh Gadai akan menolak — untuk itu pakai 'Cocokkan'."
                  : "Bapak menyatakan baris mutasi di atas memang milik resi ini. Klaimnya akan ditandai cocok di Aceh Gadai."}
              </p>
              <textarea
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                rows={3}
                placeholder={
                  aksi === "BATAL" ? "Kenapa resi ini dianggap tidak pernah ada?"
                  : aksi === "TERIMA" ? "Apa yang Bapak periksa? (mis. rekening di foto memang milik penerima yang benar)"
                  : "Baris mutasi mana yang cocok?"
                }
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              />
              <div className="mt-1 text-xs text-slate-400">
                {catatan.trim().length}/10 huruf minimum
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setAksi("")} className="btn-secondary flex-1 text-sm">Batal</button>
                <button
                  onClick={jalankan}
                  disabled={sibuk || !catatanCukup}
                  className={
                    "flex-1 text-sm disabled:opacity-40 " +
                    (aksi === "COCOK" ? "btn-primary" : "btn-secondary")
                  }
                >
                  {sibuk ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
