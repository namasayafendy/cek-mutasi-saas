# Cek Mutasi BSI

Aplikasi web untuk mencocokkan transferan tebusan dari outlet/cabang dengan mutasi rekening BSI (Bank Syariah Indonesia).

## Cara kerja singkat

1. Upload PDF mutasi rekening BSI.
2. Pilih outlet + tanggal, input nominal-nominal transferan masuk hari itu (bulk).
3. Sistem cocokkan dengan aturan: nominal persis sama, tanggal di PDF <= tanggal input, max mundur 3 hari.
4. Tiap outlet pakai warna highlight beda (palette 20 warna).
5. Download PDF asli yang sudah ter-highlight + lampiran rekap.

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS
- Supabase (Auth + Postgres)
- pdf-lib (overlay highlight) + pdfjs-dist (parser)
- Hosted di Vercel

## Setup development

\`\`\`bash
npm install
cp .env.example .env.local
# isi NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
npm run dev
\`\`\`

## Database

Migration ada di \`supabase/migrations/\`. Sudah ter-apply via Supabase MCP.
