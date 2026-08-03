"use server";

// ============================================================
// CEKTRANSFER - Resi yang belum ketemu di mutasi (Lapis 2)
// File: app/(app)/belum-cocok/actions.ts
//
// Daftar resi yang SUDAH divonis tidak ada di mutasi rekening, beserta tiga
// hal yang bisa dilakukan padanya.
//
// KENAPA DAFTARNYA DATANG DARI GADAI, bukan dari sini:
// cektransfer hanya menarik klaim berstatus PENDING. Begitu sebuah klaim
// divonis UNMATCHED, ia tidak pernah ditarik lagi — jadi dari sisi sini ia
// lenyap dari pandangan TEPAT pada saat ia mulai jadi masalah.
//
// KENAPA ADA PENCARI BARIS CALON:
// sebab paling sering sebuah klaim gadai tidak ketemu BUKAN karena uangnya
// tidak ada, melainkan karena baris mutasinya sudah diklaim lebih dulu oleh
// input yang diketik tangan di menu /check. Dua pembukuan memperebutkan kolam
// yang sama, dan yang kalah selalu klaim gadai karena ia datang belakangan.
// Tanpa pencari ini, pemilik melihat "tidak ditemukan" padahal di layar
// riwayat barisnya jelas-jelas ada dan bertanda cocok — persis kebingungan
// yang melahirkan halaman ini (SJB-1-0053 dan SBR-4-0197, 28 Juli 2026).
// ============================================================

import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";

/** Keputusan pemilik 28 Juli 2026: apa pun sebelum tanggal ini sudah beres. */
const LANTAI = "2026-07-22";

/** Jendela pencarian baris calon, dalam hari, ke dua arah dari tanggal klaim.
 *  Cukup lebar untuk menangkap transaksi yang dicatat besoknya (kasus nyata:
 *  slip 24 Juli 22:09 tercatat sebagai transaksi 25 Juli), cukup sempit supaya
 *  daftarnya tetap bisa dibaca. */
const JENDELA_HARI = 4;

async function konfigGadai() {
  const ctx = await getAccountContext();
  if (!ctx) return null;
  const db = await createClient();
  const { data } = await db
    .from("account_settings")
    .select("gadai_sync_enabled, gadai_api_url, gadai_api_key")
    .eq("account_id", ctx.account.id)
    .maybeSingle();
  const c = data as any;
  if (!c?.gadai_sync_enabled || !c.gadai_api_url || !c.gadai_api_key) return null;
  return { base: String(c.gadai_api_url).replace(/\/+$/, ""), key: String(c.gadai_api_key), ctx, db };
}

export interface BarisBelumCocok {
  klaim_id: string;
  no_faktur: string;
  outlet: string;
  tgl: string;
  nominal: number;
  umur: number;
  arah?: string;
  jenis?: string;
  /** Status mentah klaim di gadai: UNMATCHED | DUPLIKAT | PENDING | BUKTI_BEDA. */
  status?: string;
  /** Status SEBENARNYA klaim itu. Untuk BUKTI_BEDA biasanya MATCHED — uangnya
   *  sudah ketemu, yang dipertanyakan cuma fotonya. */
  status_asli?: string;
  /** Sebab dalam bahasa pemilik — tiap sebab menuntut tindakan berbeda:
   *  "tidak ada di rekening"            -> uangnya belum ketemu
   *  "resi dipakai kontrak lain (dobel)" -> satu resi diklaim dua kontrak
   *  "belum pernah divonis…"             -> kalah berebut baris / di luar periode */
  sebab?: string;
}

export interface KandidatMutasi {
  id: string;
  tgl: string;
  jam: string;
  nominal: number;
  pihak: string;
  no_ref: string;
  /** null = masih bebas. Kalau terisi, baris ini sudah dipegang sesuatu. */
  dipegang: null | {
    /** true = klaim gadai lain; false = input ketikan tangan di menu /check. */
    dariGadai: boolean;
    /** Id klaim gadai pemegangnya. "Klaim lain" tanpa nama tidak bisa
     *  ditindaklanjuti — kejadian nyata: TFKD-367 (Bireuen) menyambar baris
     *  milik Lhokseumawe, dan itu baru bisa dilihat setelah namanya disebut. */
    klaimPemegang: string | null;
    tanggalInput: string;
    nominalInput: number;
    caraCocok: string;
  };
}

export async function ambilBelumCocok(): Promise<
  { ok: true; items: BarisBelumCocok[]; salahArah: number } | { ok: false; msg: string }
> {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi Aceh Gadai belum dikonfigurasi." };
  try {
    // ── SAMPAI TANGGAL BERAPA MUTASI SUDAH ADA DI SINI ──
    //
    // Gadai tidak tahu ini, dan tanpa memberitahunya ia tidak bisa membedakan
    // resi yang MENGGANTUNG dari resi yang sekadar sedang MENUNGGU giliran.
    // Menagih yang sedang menunggu = alarm palsu tiap hari, dan alarm palsu
    // adalah cara paling pasti membuat layar ini berhenti dibuka.
    //
    // Diambil MAX(tgl_akhir) seluruh rekening. Dengan satu rekening ini tepat;
    // kalau nanti ada rekening kedua yang tertinggal jauh, batas ini terlalu
    // maju untuk rekening itu — saat itu ia perlu dipisah per bank.
    let tercakup: string | null = null;
    try {
      const ctx = await getAccountContext();
      if (ctx) {
        const db = await createClient();
        const { data } = await db
          .from("mutasi_coverage")
          .select("tgl_akhir")
          .eq("account_id", ctx.account.id)
          .order("tgl_akhir", { ascending: false })
          .limit(1)
          .maybeSingle();
        const t = (data as any)?.tgl_akhir;
        if (t) tercakup = String(t).slice(0, 10);
      }
    } catch (e) {
      // Gagal membaca cakupan bukan alasan menggagalkan daftarnya. Tanpa
      // `tercakup`, gadai hanya mengirim UNMATCHED + DUPLIKAT — perilaku lama
      // yang aman, bukan diam.
      console.error("[belum-cocok] gagal baca cakupan mutasi:", e);
    }

    const res = await fetch(
      `${k.base}/api/transfer-klaim/tunggakan?sejak=${LANTAI}` +
      (tercakup ? `&tercakup=${tercakup}` : ""), {
      headers: { Authorization: `Bearer ${k.key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      // 404 hampir selalu berarti gadai belum di-promote. Menyebutnya apa
      // adanya menghemat satu jam penelusuran.
      return {
        ok: false,
        msg: res.status === 404
          ? "Endpoint tunggakan belum ada di Aceh Gadai (HTTP 404) — kemungkinan besar belum di-promote."
          : `Tidak bisa menghubungi Aceh Gadai (HTTP ${res.status}).`,
      };
    }
    const j = await res.json();
    if (!j?.ok) return { ok: false, msg: j?.msg ?? "Jawaban tidak dikenali." };
    return {
      ok: true,
      items: (j.items ?? []) as BarisBelumCocok[],
      salahArah: Number(j.salahArah ?? 0),
    };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Cari baris mutasi yang MUNGKIN milik klaim ini, beserta siapa pemegangnya.
 *
 * Nominal sengaja TIDAK dipaksa sama persis: selisih biaya admin (mis. resi
 * 776.500 sedangkan yang mendarat 774.000) justru salah satu sebab paling
 * sering klaim tidak ketemu otomatis. Toleransinya sempit — cukup untuk biaya
 * bank, tidak cukup untuk menyamakan dua transaksi yang berbeda.
 */
export async function cariKandidat(
  tgl: string,
  nominal: number,
  arah: string,
  /**
   * Nominal yang DICARI, kalau berbeda dari nilai resi.
   *
   * Dibutuhkan untuk kasus SATU TRANSFER MENUTUP BEBERAPA PERMINTAAN: kasir
   * membuat permintaan 4jt lalu 1jt, tapi mentransfernya sekali sebesar 5jt
   * (kejadian nyata 23 Juli 2026, permintaan #380 + #381). Klaim 4jt tidak
   * akan pernah menemukan baris 5jt lewat pencarian bawaan, karena jendelanya
   * cuma selebar biaya bank. Tanpa jalan ini, penutupan yang benar mustahil
   * dan satu-satunya pilihan tersisa adalah menuliskan sesuatu yang salah.
   */
  nominalCari?: number,
  /**
   * Tanggal yang DICARI, kalau berbeda dari tanggal klaim.
   *
   * Dibutuhkan karena tanggal klaim adalah tanggal KONTRAK, sedangkan uangnya
   * mendarat pada tanggal SLIP — dan keduanya bisa berjauhan. Kejadian nyata:
   * SBR-1-0314 Rp 800.000, kontrak ditutup 1 Agustus tapi konsumen mentransfer
   * 26 Juli. Jendela bawaan ±4 hari berjangkar di 1 Agustus, jadi baris 26 Juli
   * MUSTAHIL muncul — pemilik melihat "tidak ada kandidat" untuk uang yang
   * jelas-jelas ada di rekening, dan tidak punya satu pun cara menutupnya.
   *
   * (Sejak 3 Agustus klaim BARU sudah memakai tanggal slip, jadi ini terutama
   * untuk klaim lama dan untuk slip yang tanggalnya gagal terbaca AI.)
   */
  tglCari?: string,
): Promise<{ ok: true; items: KandidatMutasi[] } | { ok: false; msg: string }> {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi belum dikonfigurasi." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return { ok: false, msg: "Tanggal tidak dikenali." };
  const pakaiTgl = typeof tglCari === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tglCari);
  const jangkar = pakaiTgl ? (tglCari as string) : tgl;

  const geser = (n: number) => {
    const d = new Date(`${jangkar}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const kolom = String(arah).toUpperCase() === "DEBET" ? "nominal_debet" : "nominal_kredit";
  // Pencarian bawaan bertoleransi sempit — cukup untuk biaya bank, tidak cukup
  // untuk menyamakan dua transaksi berbeda. Kalau pemilik menyebut nominal
  // sendiri, yang dicari angka ITU dan toleransinya nol: ia sedang menunjuk
  // baris tertentu, bukan menebak-nebak.
  const pakaiCustom = typeof nominalCari === "number" && nominalCari > 0;
  const target = pakaiCustom ? Math.round(nominalCari as number) : nominal;
  const TOLERANSI = pakaiCustom ? 0 : 50_000;

  try {
    const { data, error } = await k.db
      .from("parsed_transactions")
      .select(`id, tanggal, jam, ${kolom}, nama_pengirim, nama_penerima, no_ref, claimed_by_input_id`)
      .eq("account_id", k.ctx.account.id)
      // Kalau pemilik menyebut tanggal sendiri, jendelanya dipersempit jadi
      // ±1 hari: ia sedang MENUNJUK hari tertentu, bukan menebak-nebak, dan
      // jendela lebar hanya akan mengubur barisnya di antara baris lain.
      .gte("tanggal", geser(pakaiTgl ? -1 : -JENDELA_HARI))
      .lte("tanggal", geser(pakaiTgl ? 1 : JENDELA_HARI))
      .gte(kolom, Math.max(1, target - TOLERANSI))
      .lte(kolom, target + TOLERANSI)
      .order("tanggal", { ascending: true })
      .limit(40);
    if (error) return { ok: false, msg: error.message };

    const rows = (data ?? []) as any[];
    const idPemegang = rows.map((r) => r.claimed_by_input_id).filter(Boolean);
    const peta = new Map<string, any>();
    if (idPemegang.length > 0) {
      const { data: inp } = await k.db
        .from("cek_inputs")
        .select("id, tanggal_input, nominal, matched_by, gadai_klaim_id, manual_claim_reason")
        .in("id", idPemegang);
      (inp ?? []).forEach((x: any) => peta.set(String(x.id), x));
    }

    return {
      ok: true,
      items: rows.map((r) => {
        const p = r.claimed_by_input_id ? peta.get(String(r.claimed_by_input_id)) : null;
        return {
          id: String(r.id),
          tgl: String(r.tanggal ?? "").slice(0, 10),
          jam: String(r.jam ?? ""),
          nominal: Number(r[kolom] ?? 0),
          pihak: String(r.nama_pengirim || r.nama_penerima || ""),
          no_ref: String(r.no_ref ?? ""),
          dipegang: p
            ? {
                dariGadai: !!p.gadai_klaim_id,
                klaimPemegang: p.gadai_klaim_id ? String(p.gadai_klaim_id) : null,
                tanggalInput: String(p.tanggal_input ?? "").slice(0, 10),
                nominalInput: Number(p.nominal ?? 0),
                caraCocok: String(p.matched_by ?? (p.manual_claim_reason ? "COCOK MANUAL" : "-")),
              }
            : null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Nyatakan bukti foto yang MEMBANTAH permintaannya sudah diperiksa.
 *
 * BUKAN penutupan "uangnya ketemu" — untuk itu ada cocokkanManual. Ini menutup
 * pertanyaan yang BERBEDA: uangnya sudah ketemu di rekening, tapi FOTO buktinya
 * menunjuk nominal atau rekening lain. Hanya manusia yang bisa memutuskan
 * apakah itu wajar.
 *
 * Kejadian yang melahirkannya: SJB-2-0085 — rekening di foto 7182468201, yang
 * diminta 901002299804, sementara Rp 1 juta-nya sudah jelas diklaim Langsa dan
 * benar. Tidak ada aturan yang bisa menyimpulkan itu, dan sebelum ini tidak ada
 * tombolnya — jadi ia muncul terus dan pemiliknya tidak bisa berbuat apa-apa.
 *
 * Sisi gadai menolak kalau klaimnya masih UNMATCHED: kalau uangnya sendiri
 * belum ketemu, yang belum terjawab bukan fotonya.
 */
export async function terimaBuktiBeda(klaimId: string, alasan: string) {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi belum dikonfigurasi." };
  if (alasan.trim().length < 10) {
    return { ok: false, msg: "Alasan wajib diisi minimal 10 huruf — sebutkan apa yang Bapak periksa." };
  }
  try {
    const res = await fetch(`${k.base}/api/transfer-klaim/terima-bukti`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ klaimId, alasan: alasan.trim() }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) {
      return { ok: false, msg: j?.msg ?? `Gagal (HTTP ${res.status}).` };
    }
    return { ok: true, msg: j.msg ?? "Ditandai sudah diperiksa." };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Nyatakan sebuah resi SUDAH dicocokkan manual ke baris mutasi.
 *
 * Ini menutup dengan BUKTI — pemilik menunjuk baris mutasi yang mesin
 * lewatkan (nama beda, jam meleset, resi tersensor, atau barisnya sudah
 * dipegang input ketikan tangan). Karena itu ia menandai klaimnya cocok di
 * sisi gadai.
 */
export async function cocokkanManual(
  klaimId: string,
  catatan: string,
  barisId?: string,
  /** Nama outlet milik klaim ini, untuk mengisi kolom OUTLET di /history. */
  outletKlaim?: string,
) {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi belum dikonfigurasi." };
  if (catatan.trim().length < 10) {
    return { ok: false, msg: "Catatan wajib diisi minimal 10 huruf — sebutkan baris mutasi mana yang cocok." };
  }

  // ── BARIS YANG DIPILIH IKUT DIKLAIM DI SINI, BUKAN CUMA DI GADAI ──
  //
  // Versi lama hanya mengabari gadai "klaim ini cocok" dan MEMBUANG baris mutasi
  // yang dipilih pemilik — parameternya bahkan tidak pernah dikirim. Dua akibat,
  // dan yang kedua jauh lebih berbahaya daripada yang dikeluhkan:
  //
  //   1. Di /history barisnya tetap tertulis "belum match", padahal pemilik baru
  //      saja menutupnya. Itu yang terlihat.
  //   2. Barisnya tetap BEBAS, jadi klaim lain masih bisa mengambilnya —
  //      satu uang dipakai membuktikan dua transaksi. Itulah bentuk penipuan
  //      resi-kembar yang seluruh sistem ini dibangun untuk menangkapnya, dan
  //      jalur manual melewatinya diam-diam.
  //
  // Urutannya: KLAIM DULU di sini (compare-and-set, jadi rebutan kalah dengan
  // bersih), baru kabari gadai. Kalau gadai menolak, klaimnya DIBATALKAN lagi
  // supaya bisa diulang — lebih baik gagal utuh daripada setengah jadi.
  let inputId: string | null = null;
  if (barisId) {
    const now = new Date().toISOString();
    const { data: tx } = await k.db
      .from("parsed_transactions")
      .select("id, bank_id, tanggal, nominal_kredit, nominal_debet, claimed_by_input_id")
      .eq("id", barisId).eq("account_id", k.ctx.account.id).maybeSingle();
    if (!tx) return { ok: false, msg: "Baris mutasi tidak ditemukan." };
    if ((tx as any).claimed_by_input_id) {
      return { ok: false, msg: "Baris mutasi itu sudah dipegang klaim lain. Muat ulang dan pilih baris lain." };
    }

    const kredit = Number((tx as any).nominal_kredit || 0);
    const jenis = kredit > 0 ? "kredit" : "debet";

    // Outlet dicocokkan lewat NAMA, sama seperti penarik klaim. Tanpa ini kolom
    // OUTLET di /history tampil "—" untuk baris yang jelas punya pemilik.
    let outletId: string | null = null;
    try {
      const nm = (x: string) => String(x ?? "").trim().replace(/\s+/g, " ").toUpperCase();
      const { data: outs } = await k.db.from("outlets").select("id, nama").eq("account_id", k.ctx.account.id);
      const cari = nm(outletKlaim ?? "");
      const ket = (outs ?? []).find((o: any) => nm(o.nama) === cari);
      if (ket) outletId = String((ket as any).id);
    } catch { /* outlet tak ketemu bukan alasan menggagalkan penutupan */ }

    const { data: ins, error: insErr } = await k.db
      .from("cek_inputs")
      .insert({
        session_id: null,
        account_id: k.ctx.account.id,
        tanggal_input: String((tx as any).tanggal ?? "").slice(0, 10),
        outlet_id: outletId,
        bank_id: (tx as any).bank_id ?? null,
        nominal: kredit > 0 ? kredit : Number((tx as any).nominal_debet || 0),
        jenis,
        match_status: "manual_claimed",
        matched_tx_id: barisId,
        // matched_by SENGAJA dibiarkan kosong. Kolom itu berarti CARA MESIN
        // mencocokkan (REF / NAMA_JAM / NOMINAL); penutupan tangan bukan salah
        // satunya, dan layar sudah menampilkan "COCOK MANUAL" dari
        // manual_claim_reason. Mengisinya cuma melahirkan bentuk kedua yang
        // mirip tapi beda dengan baris yang sudah ada dari modal /history.
        manual_claim_reason: catatan.trim(),
        manual_claimed_at: now,
        // Supaya pencari kandidat bisa menyebut SIAPA pemegangnya, bukan cuma
        // "sudah dipakai" — pelajaran dari TFKD-367 yang menyambar baris milik
        // outlet lain dan baru bisa dilihat setelah namanya disebut.
        gadai_klaim_id: klaimId,
      })
      .select("id").single();
    if (insErr || !ins) return { ok: false, msg: `Gagal mencatat penutupan: ${insErr?.message ?? "unknown"}` };
    inputId = String((ins as any).id);

    const { data: upd, error: updErr } = await k.db
      .from("parsed_transactions")
      .update({ claimed_by_input_id: inputId, claimed_at: now, manual_claim_reason: catatan.trim() })
      .eq("id", barisId)
      .is("claimed_by_input_id", null)   // ada yang menyambar duluan -> kalah bersih
      .select("id");
    if (updErr || !upd || upd.length === 0) {
      await k.db.from("cek_inputs").delete().eq("id", inputId);
      return { ok: false, msg: "Baris mutasi itu baru saja dipegang klaim lain. Muat ulang dan pilih baris lain." };
    }
  }

  try {
    const res = await fetch(`${k.base}/api/transfer-klaim/manual`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ klaimId, catatan: catatan.trim() }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      await batalkanKlaimLokal(k, inputId, barisId);
      return { ok: false, msg: j?.msg ?? `Gagal (HTTP ${res.status}).` };
    }
    return {
      ok: true,
      msg: (j.msg ?? "Ditandai cocok di Aceh Gadai.") +
           (barisId ? " Baris mutasinya ikut ditandai di Riwayat." : ""),
    };
  } catch (e) {
    await batalkanKlaimLokal(k, inputId, barisId);
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/** Lepas kembali baris mutasi kalau gadai menolak — supaya bisa diulang. */
async function batalkanKlaimLokal(k: any, inputId: string | null, barisId?: string) {
  if (!inputId || !barisId) return;
  try {
    await k.db.from("parsed_transactions")
      .update({ claimed_by_input_id: null, claimed_at: null, manual_claim_reason: null })
      .eq("id", barisId).eq("claimed_by_input_id", inputId);
    await k.db.from("cek_inputs").delete().eq("id", inputId);
  } catch (e) {
    console.error("[belum-cocok] gagal melepas klaim lokal:", e);
  }
}

/**
 * Nyatakan sebuah resi TIDAK PERNAH ADA — salah catat.
 *
 * BUKAN untuk "resinya ada tapi tidak ketemu di rekening". Itu tuduhan uang
 * hilang, dan membatalkannya berarti menghapus pertanyaannya, bukan
 * menjawabnya. Sisi gadai menolak membatalkan klaim yang sudah MATCHED.
 */
export async function batalkanKlaim(klaimId: string, alasan: string) {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi belum dikonfigurasi." };
  if (alasan.trim().length < 10) {
    return { ok: false, msg: "Alasan wajib diisi minimal 10 huruf — sebutkan kenapa resi ini dianggap tidak pernah ada." };
  }
  try {
    const res = await fetch(`${k.base}/api/transfer-klaim/batal`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ klaimId, alasan: alasan.trim() }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) return { ok: false, msg: j?.msg ?? `Gagal (HTTP ${res.status}).` };
    return { ok: true, msg: j.msg ?? "Klaim dibatalkan di Aceh Gadai." };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}
