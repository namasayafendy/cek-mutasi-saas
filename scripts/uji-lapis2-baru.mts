// Merender laporan LAPIS 2 memakai payload sandingan HIDUP (hasil
// scripts/uji-sandingan-baru.mts di repo aceh-gadai). Tujuannya melihat teks
// yang benar-benar akan dikirim, bukan menebak bentuknya dari kode.
//   npx tsx scripts/uji-lapis2-baru.mts <sand.json>
import { readFileSync } from "node:fs";
import { susunLapis2, type IsiLapis2 } from "../lib/laporan/lapis2.ts";

const sand = JSON.parse(readFileSync(process.argv[2], "utf8"));

const isi: IsiLapis2 = {
  bankLabel: "BSI 1999881994",
  namaFile: "mutasi.pdf",
  berkasDari: sand.dari, berkasSampai: sand.sampai,
  nilaiDari: sand.dari, nilaiSampai: sand.sampai,
  utuh: true, rantaiPutus: 0, nyambung: true, selisihSambungan: 0,
  perTanggal: [
    { tgl: "2026-08-03", jml: 39, rp: 64725000, masukJml: 35, masukRp: 40935000, keluarJml: 4, keluarRp: 23790000 },
  ],
  nDiuji: 53, rpDiuji: 81782000, nCocok: 53,
  tertahanGerbang: { jml: 1, rp: 1000000,
    perSebab: [{ sebab: "FOTO_NOMINAL_BEDA", teks: "nominal di bukti BEDA dari yang diminta", n: 1, rp: 1000000 }],
    gerbangError: null },
  tidakKetemu: [],
  ditahanLuarPeriode: 0, ditahanKonflik: 0,
  kreditNganggur: [], rpKreditNganggur: 0,
  debetNganggur: [], rpDebetNganggur: 0,
  nganggurDiperiksa: true,
  sandingan: sand as IsiLapis2["sandingan"],
  tunggakan: [],
  gagal: [],
};

console.log(susunLapis2(isi, { nomor: 12, sebelumNomor: 11, sebelumKapan: sand.sejak }));
