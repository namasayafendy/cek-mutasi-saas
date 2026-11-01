// ============================================================
// KANAL MASUK MUTASI — Baca & stempel BARIS MUTASI TANPA PEMILIK
// File: lib/pipeline/nganggur.ts
//
// Dipisah dari jalankanPass (1 November 2026) supaya janji di
// lib/laporan/nganggur.ts — "yang distempel = yang dirinci" — bisa diuji
// dengan DB tiruan tanpa menjalankan seluruh pass. MEMBACA dilakukan
// jalankanPass (peramban); MENSTEMPEL dilakukan tandaiSelesai (server),
// sesudah laporan yang merincinya tercatat. Berkas ini hanya kuerinya.
// ============================================================
/* eslint-disable @typescript-eslint/no-explicit-any -- baris DB tanpa tipe, sama seperti jalankanPass.ts */

import type { SupabaseClient } from "@supabase/supabase-js";
import { BATAS_RINCI_NGANGGUR, type BarisNganggur, type BarisPindah } from "@/lib/laporan/nganggur";
import { bacaCalonPindah, pasangkanPindah, sesiDalamRentang, type KakiPindah, type SesiPindah } from "@/lib/pipeline/pindahSaldo";

export interface OpsiBacaNganggur {
  accountId: string;
  jenis: "kredit" | "debet";
  /** Dua rekening: hanya baris rekening berkas ini. null = semua rekening
   *  akun (perilaku lama, satu rekening). */
  bankId: string | null;
  dari: string;
  sampai: string;
  /** Jaring kedua — lihat bacaNganggur di jalankanPass. */
  idTerpakai: Set<string>;
  /** JEMBATAN PINDAH SALDO (lib/pipeline/pindahSaldo.ts): sesi PINDAH
   *  SELESAI dari gadai yang kakinya ada di rekening berkas ini (`bankId`
   *  WAJIB). Tidak ada / null = perilaku lama persis. `kaki` = kaki yang
   *  dinilai berkas ini (kakiPindahBerkas). */
  pindah?: { sesi: SesiPindah[]; rute: string; kaki: KakiPindah } | null;
}

export interface HasilBacaNganggur {
  /** Baris yang masuk daftar laporan — urutan dan isinya SAMA dengan `ids`. */
  rows: BarisNganggur[];
  /** id baris di `rows`; HANYA ini yang boleh distempel nanti. */
  ids: string[];
  /** Cacah utuh yang belum pernah dilaporkan (≥ rows.length). */
  belumLapor: number;
  /** Berapa yang disaring jaring memori. */
  tersaring: number;
  /** Hanya bila `pindah` diminta: baris yang dikenali sebagai kaki PINDAH
   *  SALDO resmi — DIKELUARKAN dari `rows`/`ids`/`belumLapor`, dirinci di
   *  blok sendiri, dan (bersama `ids`) boleh distempel. */
  pindah?: { rows: BarisPindah[]; ids: string[]; catatan: string[] };
}

/**
 * Baca baris tanpa pemilik yang BELUM distempel, paling banyak
 * BATAS_RINCI_NGANGGUR — tanggal tertua dulu, jadi yang tidak muat selalu
 * tanggal paling baru. Ia terbaca lagi hanya oleh berkas yang MULAI pada/
 * sebelum tanggalnya (`dari` = awal berkas), dan laporan menyebut tanggal itu.
 *
 * MELEMPAR kalau kueri ditolak. supabase-js tidak melempar sendiri: galatnya
 * datang sebagai `error` dengan `data` null, dan dulu null itu terbaca "nol
 * baris" — laporan mencetak "✅ tidak ada" untuk pemeriksaan yang tidak
 * pernah jalan. Pemanggil menangkapnya dan menandai "tidak diperiksa".
 */
export async function bacaBarisNganggur(
  supabase: SupabaseClient<any, any, any>,
  o: OpsiBacaNganggur,
): Promise<HasilBacaNganggur> {
  const kolom = o.jenis === "debet" ? "nominal_debet" : "nominal_kredit";
  let q = supabase
    .from("parsed_transactions")
    .select(`id, tanggal, jam, ${kolom}, nama_pengirim, nama_penerima, deskripsi`, { count: "exact" })
    .eq("account_id", o.accountId);
  // Dua rekening: baris rekening LAIN bukan urusan berkas ini — menyebut
  // (dan menstempel) baris KELUAR saat memproses MASUK membuatnya tidak
  // pernah muncul di laporan KELUAR sendiri, padahal ia belum dinilai.
  if (o.bankId) q = q.eq("bank_id", o.bankId);
  const { data: barisBaru, count, error } = await q
    .gte("tanggal", o.dari)
    .lte("tanggal", o.sampai)
    .is("claimed_by_input_id", null)
    .is("unclaimed_reported_at", null)
    // Baris yang sudah dihapus bukan "uang tanpa pemilik". Pembaca lain
    // (carryover, persist) juga belum punya saringan ini — di sini ia
    // paling mahal kalau luput, karena keluarannya sebuah tuduhan.
    .is("deleted_at", null)
    .gt(kolom, 0)
    .order("tanggal", { ascending: true })
    .limit(BATAS_RINCI_NGANGGUR);
  if (error) throw new Error(`baca baris tanpa pemilik ditolak: ${error.message}`);

  const semua = (barisBaru ?? []) as any[];
  const terbaca = semua.filter((t) => !o.idTerpakai.has(String(t.id)));
  const tersaring = semua.length - terbaca.length;
  const bentuk = (t: any): BarisNganggur => ({
    tgl: String(t.tanggal ?? "").slice(0, 10),
    jam: String(t.jam ?? ""),
    nominal: Number(t[kolom] ?? 0),
    pihak: String(t.nama_pengirim || t.nama_penerima || ""),
    ket: String(t.deskripsi ?? "").slice(0, 60),
  });

  // ── JEMBATAN PINDAH SALDO (lib/pipeline/pindahSaldo.ts) ──
  // Kaki pindah saldo resmi dipisah dari "tanpa pemilik". Galat apa pun di
  // sini = tidak ada yang dipisah (barisnya tetap disebut tanpa pemilik, arah
  // yang aman) + catatan; TIDAK melempar, supaya pemeriksaan tanpa pemilik
  // tidak berubah jadi "tidak jalan". Tanpa `o.pindah` blok ini diam.
  let pindah: HasilBacaNganggur["pindah"];
  let pasangan = new Map<string, string>();
  if (o.pindah) {
    const catatan: string[] = [];
    const sesi = o.bankId ? sesiDalamRentang(o.pindah.sesi, o.dari, o.sampai) : [];
    if (sesi.length) {
      try {
        const calonPerSesi = await bacaCalonPindah(supabase, {
          accountId: o.accountId, bankId: o.bankId!, kolom, sesi,
        });
        const h = pasangkanPindah({
          sesi, calonPerSesi, idTerbaca: new Set(terbaca.map((t) => String(t.id))),
          kaki: o.pindah.kaki, idDiklaimPassIni: o.idTerpakai,
        });
        pasangan = h.pasangan;
        catatan.push(...h.catatan);
      } catch (e) {
        pasangan = new Map();
        catatan.push(`jembatan pindah saldo tidak bisa memeriksa mutasi (${e instanceof Error ? e.message.slice(0, 80) : "galat"}) — kaki pindah saldo tetap disebut sebagai tanpa pemilik.`);
      }
    }
    const kaki = terbaca.filter((t) => pasangan.has(String(t.id)));
    pindah = {
      rows: kaki.map((t) => ({ ...bentuk(t), sesi: pasangan.get(String(t.id))!, rute: o.pindah!.rute })),
      ids: kaki.map((t) => String(t.id)),
      catatan,
    };
  }
  const rows = pasangan.size ? terbaca.filter((t) => !pasangan.has(String(t.id))) : terbaca;

  return {
    rows: rows.map(bentuk),
    ids: rows.map((t) => String(t.id)),
    // Cacah UTUH dilaporkan terpisah dari yang ditampilkan. Memotong di batas
    // tanpa menyebut sisanya berbunyi persis seperti "cuma segini".
    // Dikurangi yang tersaring jaring memori: arah galatnya jadi "sedikit
    // melebihkan sisa", dan itu arah yang aman — paling banyak ia menambah
    // baris "masih ada N lagi", bukan menghilangkan sesuatu.
    // Kaki pindah saldo yang dikenali ikut terbaca (dan distempel bersama
    // daftar ini) — ia bukan sisa yang belum dirinci.
    belumLapor: Math.max(0, Number(count ?? semua.length) - tersaring - (pindah?.ids.length ?? 0)),
    tersaring,
    ...(pindah ? { pindah } : {}),
  };
}

/** Ukuran satu `.in()` penstempel. id uuid ±37 huruf; ±200 sudah membuat URL
 *  PostgREST kepanjangan, jadi dua arah (≤ 2 × BATAS_RINCI_NGANGGUR) dipecah. */
const BATCH_STEMPEL = 100;

/**
 * Stempel "sudah diberitahukan". SERVER-ONLY (service_role, dari
 * tandaiSelesai) dan HANYA sesudah laporan yang merincinya tercatat.
 * Tidak pernah melempar.
 *
 * id datang dari peramban lewat ringkasan, jadi setiap baris diperiksa ulang
 * di sini: milik akun ini, belum diklaim, dan belum pernah distempel —
 * stempel pertama tidak ditimpa, dan baris yang keburu diklaim sesudah
 * dibaca bukan lagi "tanpa pemilik".
 *
 * @returns false kalau ada batch yang ditolak (barisnya disebut lagi nanti).
 */
export async function stempelBarisNganggur(
  supabase: SupabaseClient<any, any, any>,
  accountId: string,
  ids: string[],
): Promise<boolean> {
  if (!ids.length) return true;
  let semuaOk = true;
  for (let i = 0; i < ids.length; i += BATCH_STEMPEL) {
    try {
      const { error } = await supabase
        .from("parsed_transactions")
        .update({ unclaimed_reported_at: new Date().toISOString() })
        .eq("account_id", accountId)
        .is("claimed_by_input_id", null)
        .is("unclaimed_reported_at", null)
        .in("id", ids.slice(i, i + BATCH_STEMPEL));
      // Gagal menstempel berarti baris ini akan disebut lagi besok.
      // Mengulang jauh lebih baik daripada menghilangkannya.
      if (error) {
        semuaOk = false;
        console.error("[nganggur] gagal menstempel baris tanpa pemilik:", error.message);
      }
    } catch (e) {
      semuaOk = false;
      console.error("[nganggur] gagal menstempel baris tanpa pemilik:", e);
    }
  }
  return semuaOk;
}
