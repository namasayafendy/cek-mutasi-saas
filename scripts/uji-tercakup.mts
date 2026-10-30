// Uji lib/coverage/tercakup.ts (bacaTercakupAkun) — DB tiruan, tanpa jaringan.
//   npx tsx scripts/uji-tercakup.mts
import { bacaTercakupAkun } from "../lib/coverage/tercakup.ts";

let lulus = 0;
let gagal = 0;
const cek = (nama: string, benar: boolean, ket = "") => {
  if (benar) lulus++;
  else gagal++;
  console.log(`  ${benar ? "ok  " : "GAGAL"} ${nama}${!benar && ket ? "  — " + ket : ""}`);
};

type Baris = Record<string, any>;
function dbTiruan(banks: Baris[], cakupan: Baris[]) {
  return {
    from(tabel: string) {
      const saring: ((r: Baris) => boolean)[] = [];
      const urut: { k: string; asc: boolean }[] = [];
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { saring.push((r) => String(r[k]) === String(v)); return q; },
        order: (k: string, o: { ascending: boolean }) => { urut.push({ k, asc: o.ascending }); return q; },
        limit: () => q,
        then: (res: any) => res({ data: (tabel === "banks" ? banks : []).filter((r) => saring.every((f) => f(r))), error: null }),
        maybeSingle: async () => {
          const rows = cakupan.filter((r) => saring.every((f) => f(r))).sort((a, b) => {
            for (const u of urut) if (a[u.k] !== b[u.k]) return (a[u.k] < b[u.k] ? -1 : 1) * (u.asc ? 1 : -1);
            return 0;
          });
          return { data: rows[0] ?? null, error: null };
        },
      };
      return q;
    },
  } as any;
}
const A = "akun";
const MASUK = { id: "m", account_id: A, peran: "MASUK", nomor_rekening: "1999881994", is_active: true };
const KELUAR = { id: "k", account_id: A, peran: "KELUAR", nomor_rekening: "1999881919", mulai_tgl: "2026-11-01", is_active: true };
const cak = (bank: string, akhir: string, at: string) => ({ account_id: A, bank_id: bank, tgl_akhir: akhir, created_at: at });

console.log("\n1. Tanpa rekening KELUAR = perilaku lama (MAX semua rekening)");
{
  const db = dbTiruan([{ id: "b1", account_id: A }], [cak("b1", "2026-10-28", "2026-10-29T01:00:00Z"), cak("b1", "2026-10-29", "2026-10-30T02:00:00Z")]);
  const t = await bacaTercakupAkun(db, A);
  cek("tercakup = 29 Okt", t?.tercakup === "2026-10-29", JSON.stringify(t));
  cek("jam baris itu", t?.tercakupAt === "2026-10-30T02:00:00.000Z");
}

console.log("\n2. KELUAR terdaftar tapi belum punya PDF → dibatasi sehari sebelum mulai (bukan null)");
{
  const db = dbTiruan([MASUK, KELUAR], [cak("m", "2026-11-03", "2026-11-04T01:00:00Z")]);
  const t = await bacaTercakupAkun(db, A);
  cek("tercakup = 31 Okt", t?.tercakup === "2026-10-31", JSON.stringify(t));
  cek("jam = jam MASUK", t?.tercakupAt === "2026-11-04T01:00:00.000Z");
}

console.log("\n3. MASUK masih sebelum mulai → KELUAR tidak relevan");
{
  const db = dbTiruan([MASUK, KELUAR], [cak("m", "2026-10-29", "2026-10-30T01:00:00Z")]);
  const t = await bacaTercakupAkun(db, A);
  cek("tercakup = 29 Okt (MASUK)", t?.tercakup === "2026-10-29", JSON.stringify(t));
}

console.log("\n4. Keduanya sesudah mulai → tanggal terkecil, jam unggahan yang LEBIH AWAL");
{
  const db = dbTiruan([MASUK, KELUAR], [
    cak("m", "2026-11-05", "2026-11-06T02:00:00Z"),
    cak("k", "2026-11-04", "2026-11-05T09:00:00Z"),
  ]);
  const t = await bacaTercakupAkun(db, A);
  cek("tercakup = 4 Nov (KELUAR tertinggal)", t?.tercakup === "2026-11-04", JSON.stringify(t));
  cek("jam = yang lebih awal", t?.tercakupAt === "2026-11-05T09:00:00.000Z");
}

console.log("\n5. Tanggal SERI: jam = yang lebih awal (bukan jam rekening pertama)");
{
  const db = dbTiruan([MASUK, KELUAR], [
    cak("m", "2026-11-05", "2026-11-06T02:00:00Z"),   // MASUK diunggah lebih lambat
    cak("k", "2026-11-05", "2026-11-05T08:00:00Z"),   // KELUAR diunggah 15:00 WIB hari itu
  ]);
  const t = await bacaTercakupAkun(db, A);
  cek("tercakup = 5 Nov", t?.tercakup === "2026-11-05");
  cek("jam = KELUAR (lebih awal)", t?.tercakupAt === "2026-11-05T08:00:00.000Z", JSON.stringify(t));
}

console.log("\n6. MASUK belum punya cakupan → null (aturan lama gadai, aman)");
{
  const db = dbTiruan([MASUK, KELUAR], [cak("k", "2026-11-05", "2026-11-06T02:00:00Z")]);
  cek("null", (await bacaTercakupAkun(db, A)) === null);
}

console.log("\n7. Konfigurasi KELUAR belum lengkap → null");
{
  const db = dbTiruan([MASUK, { ...KELUAR, mulai_tgl: null }], [cak("m", "2026-11-05", "2026-11-06T02:00:00Z")]);
  cek("null", (await bacaTercakupAkun(db, A)) === null);
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal > 0) process.exit(1);
