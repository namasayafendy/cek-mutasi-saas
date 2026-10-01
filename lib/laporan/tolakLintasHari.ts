// ============================================================
// CEKTRANSFER - Resi yang "tidak ditebak" mesin: baris ADA dan BEBAS, beda hari
// File: lib/laporan/tolakLintasHari.ts
//
// Gadai hanya tahu klaim ini masih PENDING, dan menyebutnya "belum pernah
// divonis — berebut baris mutasi / di luar periode". Itu benar untuk yang
// BEREBUT (barisnya dipegang klaim lain), tapi salah untuk yang ditolak
// ditebak: di sana barisnya bebas, cuma beda hari, dan pencocokan nominal
// sengaja tidak menebak ke hari lain (pagar SJB-1-0186 / KRUKUH 23 Juli).
//
// 27 September 2026, SJB-3-0211 (BIREUEN) Rp 50.000: baris 25 Sep 22.31
// a.n. NENENG JUAIRIAH bebas sepanjang waktu, tapi layar dan laporan berkata
// "sudah dipegang klaim lain". Pemilik mencari pemegang yang tidak ada.
//
// Sumbernya baris cek_inputs TERBARU per klaim (satu klaim bisa ditahan
// berkali-kali di beberapa unggahan): kalau vonis terakhirnya all_taken dengan
// ref_issue 'BEDA_HARI_BEBAS' (lib/sessions/save.ts), sebabnya diganti dan
// tanggal baris bebasnya dibawa supaya /belum-cocok langsung membukanya.
//
// 1 Oktober 2026 — 'BERTENTANGAN' / 'BERTENTANGAN_HARI_SENDIRI_DIPEGANG':
// baris bebas bernominal sama ADA, tapi jam DAN nama di resi membantah
// semuanya (pagar (d) PASS 4; SJB-2-0056 — resi ANDINI SAHPUTRI 12:03,
// baris MUHAMMAD SIDDIQ 12.15). Ia TIDAK ditandai tolakLintasHari: layar
// /belum-cocok mengucapkan penanda itu sebagai "baris bebas, BEDA HARI" dan
// menandai barisnya 🔎 "baris bebas yang tidak ditebak" — padahal baris yang
// dibantah bisa di hari resi sendiri, dan justru TIDAK boleh disodorkan
// sebagai calon. Yang diganti hanya kalimat sebabnya.
//
// BACA-SAJA. Gagal membaca = daftar dibiarkan apa adanya (sebab gadai lama).
// ============================================================

/** "25-09-2026" / "25/09/2026" -> "2026-09-25"; format lain -> null. */
function keIso(s: unknown): string | null {
  const m = String(s ?? "").match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export interface TandaTolak {
  tolakLintasHari?: boolean;
  /** Baris di HARI RESI sendiri sudah dipegang klaim lain — tanda resi kembar. */
  hariSendiriDipegang?: boolean;
  /** Tanggal (YYYY-MM-DD) baris bebas yang ditolak ditebak mesin. */
  barisBebasTgl?: string | null;
  /** true = ditahan karena jam DAN nama resi membantah semua baris bebas
   *  bernominal sama (ref_issue 'BERTENTANGAN…'). Belum dibaca layar mana
   *  pun; sebabnya sudah diucapkan lewat `sebab`. */
  bertentangan?: boolean;
  sebab?: string;
}

export async function tandaiTolakLintasHari(
  db: any,
  accountId: string,
  items: ({ klaim_id?: string; status?: string; tgl?: string } & TandaTolak)[],
): Promise<void> {
  const tunggu = items.filter((it) => it.klaim_id && String(it.status ?? "").toUpperCase() === "PENDING");
  if (!tunggu.length) return;
  try {
    const ids = [...new Set(tunggu.map((it) => String(it.klaim_id)))];
    const terbaru = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await db
        .from("cek_inputs")
        .select("gadai_klaim_id, match_status, ref_issue, conflict_dates, created_at")
        .eq("account_id", accountId)
        .in("gadai_klaim_id", ids.slice(i, i + 150))
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as any[]) {
        const k = String(r.gadai_klaim_id);
        if (!terbaru.has(k)) terbaru.set(k, r);
      }
    }
    for (const it of tunggu) {
      const r = terbaru.get(String(it.klaim_id));
      const ri = String(r?.ref_issue ?? "");
      if (!r || r.match_status !== "all_taken") continue;
      if (ri.startsWith("BERTENTANGAN")) {
        const tglB = (Array.isArray(r.conflict_dates) ? r.conflict_dates : []) as string[];
        it.bertentangan = true;
        it.sebab = "tidak ditebak mesin — baris bernominal sama ADA" +
          (tglB.length ? ` (tgl ${tglB.join(", ")})` : "") +
          " tapi jam DAN nama di resi bertentangan dengannya; cocokkan hanya kalau foto resi membuktikan sebaliknya" +
          (ri === "BERTENTANGAN_HARI_SENDIRI_DIPEGANG"
            ? "; baris di hari resi sudah dipegang klaim lain — periksa dulu apakah resi ini kembar"
            : "");
        continue;
      }
      if (!ri.startsWith("BEDA_HARI_BEBAS")) continue;
      const tgl = (Array.isArray(r.conflict_dates) ? r.conflict_dates : []) as string[];
      const iso = tgl.map(keIso).filter(Boolean) as string[];
      // Jangkar = tanggal baris bebas yang PALING DEKAT ke tanggal resi.
      const jarak = (d: string) => Math.abs(Date.parse(`${d}T12:00:00Z`) - Date.parse(`${String(it.tgl ?? d)}T12:00:00Z`));
      iso.sort((a, b) => jarak(a) - jarak(b));
      it.tolakLintasHari = true;
      it.hariSendiriDipegang = ri === "BEDA_HARI_BEBAS_HARI_SENDIRI_DIPEGANG";
      it.barisBebasTgl = iso[0] ?? null;
      it.sebab = "tidak ditebak mesin — baris bernominal sama MASIH BEBAS" +
        (tgl.length ? ` tgl ${tgl.join(", ")}` : "") + " (beda hari)" +
        (it.hariSendiriDipegang
          ? "; baris di hari resi sudah dipegang klaim lain — periksa dulu apakah resi ini kembar"
          : "; cocokkan hanya kalau nama/jam resi sesuai");
    }
  } catch (e) {
    console.error("[tolakLintasHari] gagal menandai:", e);
  }
}
