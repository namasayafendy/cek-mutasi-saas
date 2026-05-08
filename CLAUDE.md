# Konteks untuk AI Assistant (Claude)

## Project: Cek Mutasi — Commercial SaaS Version

**Kalau Anda baru join project ini di session baru, BACA INI DULU sebelum mulai apapun:**

1. Baca `PROJECT_PLAN.md` (di root folder) — itu single source of truth untuk product, decisions, data model, roadmap.
2. Baca `AGENTS.md` (kalau ada) — code conventions
3. Cek state terbaru:
   - `git log --oneline -10` untuk lihat progress recent
   - Phase mana yang sedang dikerjakan (lihat section bawah file PROJECT_PLAN.md "Last updated")

## Owner (Customer #1)

- Nama: Fendy
- Bisnis: Aceh Gadai Syariah (pegadaian, multi-cabang)
- Email: namasayafendy@gmail.com
- Sudah pakai versi personal selama 1 bulan, decided untuk komersialisasi
- Side biz, owner punya kapasitas hire 1 admin
- Owner urus legal/business form sendiri, AI fokus ke fitur + programming

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind 4
- Supabase (Auth + Postgres + RLS + Edge Functions)
- pdfjs-dist (parser, client-side)
- pdf-lib (output PDF, client-side)
- Midtrans (payment)
- Vercel (hosting)

## Arsitektur Penting

- **PDF processed client-side, NEVER uploaded to server** — privacy by design, selling point besar
- **Multi-tenant via account_id** — semua tabel filter by account_id with RLS
- **Roles**: owner (full access) + staff (cek mutasi only)
- **Concept**: account → owner+staff team_members → outlets + banks + sessions
- **Banks include e-wallets** (Dana, OVO, dll diperlakukan sama dengan bank konvensional)

## Critical Decisions Locked (jangan ubah tanpa diskusi owner)

- Tier pricing: SINGLE FLAT (bukan multi-tier), harga TBD
- Trial: 7 hari
- Duplicate handling: First-claim-wins (no other option)
- Auto-detect bank: TIDAK dipakai (always manual select)
- Brand: TBD (placeholder "Cek Mutasi" sampai owner finalize)
- Domain: Vercel subdomain dulu

## Behaviour Rules untuk AI

- Bahasa: Indonesia di UI, English di code/comment, percakapan ke owner pakai Indonesia
- Selalu ask clarification kalau ambiguous, jangan asal asumsi
- Sebelum implementasi non-trivial: konfirmasi pendekatan ke owner dulu
- Jangan code dulu kalau owner bilang "diskusi dulu"
- Saat user-facing copy/teks, pakai bahasa yang ramah & informal (target market UMKM Indonesia)
- Format rupiah: titik separator (Rp 1.000.000)
- Format tanggal default: DD-MM-YYYY (contoh: 22-04-2026)
- Timezone: WIB (Asia/Jakarta)

## Common Gotchas (dari pengalaman versi personal)

1. **Windows mount file truncation**: Edit/Write tool ke `D:\...` kadang bikin file truncated/null bytes saat new content lebih panjang dari old. Workaround: pakai `cat > file <<EOF` via bash, atau setelah Edit cek dengan `wc -c` dan `tr -cd '\0' | wc -c`.

2. **Detached ArrayBuffer**: pdfjs-dist + pdf-lib transfer buffer ke worker → original detached. SELALU bikin copy fresh (`new Uint8Array(buf)`) sebelum pass ke pdfjs/pdf-lib.

3. **BSI parser column shift**: kolom Kredit X position bervariasi per PDF. Parser HARUS dynamic detect dari header "Kredit", JANGAN hardcode X coordinate.

4. **Supabase MCP available**: bisa apply migration langsung via tool `mcp__8538c377-..._apply_migration`. Project ID lookup via `list_projects`.

5. **Next.js 16 middleware deprecated**: file `middleware.ts` masih jalan tapi recommended rename ke `proxy.ts`. Skip dulu, fix saat Phase 0 commercial setup.

## Session Memory

Saat anda mulai session baru:
1. Baca file ini + PROJECT_PLAN.md
2. Cek `git log` untuk recent changes
3. Tanya owner: "Phase mana yg sedang aktif?" kalau tidak yakin
4. Update `PROJECT_PLAN.md` section "Last updated" setiap selesai phase

## File Locations

- Personal version (frozen): `D:\aplikasi cek mutasi bank\`
- Commercial version: TBD (akan di-create owner)
- This file (`CLAUDE.md`) dan `PROJECT_PLAN.md` ada di **kedua folder** — di personal sebagai dokumentasi historis, di commercial sebagai operating plan.
