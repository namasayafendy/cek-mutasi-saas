-- TAHAP 1 (lanjutan 4): verifikasi putaran 2.
-- Diterapkan lewat MCP apply_migration 30 Okt 2026 (versi 20261030163445).
--  a) Pengambilalihan catatan unggahan (tugas Telegram yang sama dibuka ulang)
--     ikut mengisi baris_baru dengan jumlah baris yang benar-benar dimilikinya,
--     dan hanya catatan milik PENGGUNA YANG SAMA yang boleh diambil alih.
--  b) batalkan_unggahan: banks masih di titik sebelum unggahan → 'tidak_diubah'
--     (dulu keliru disebut 'sudah_berubah_lagi' untuk unggahan yang mati
--     sebelum sempat menggeser titik saldo).
-- Kode yang sedang tayang tidak menyentuh tabel/fungsi ini.

create or replace function public.mutasi_unggahan_sebelum_sisip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  new.created_at := now();
  new.dibuat_oleh := coalesce(auth.uid(), new.dibuat_oleh);
  new.dibatalkan_at := null;
  new.dibatalkan_oleh := null;
  new.catatan_batal := null;
  new.selesai_at := null;
  new.baris_baru := 0;

  select id, recon_last_saldo, recon_last_date into b
    from public.banks
   where id = new.bank_id and account_id = new.account_id
   for update;
  if not found then
    raise exception 'Rekening tidak ditemukan di akun ini.' using errcode = 'P0001';
  end if;

  if new.job_id is not null then
    update public.mutasi_unggahan m
       set selesai_at = now(),
           baris_baru = (select count(*) from public.parsed_transactions p where p.unggah_id = m.id)
     where m.account_id = new.account_id and m.bank_id = new.bank_id and m.job_id = new.job_id
       and m.dibatalkan_at is null and m.selesai_at is null
       and m.dibuat_oleh is not distinct from coalesce(auth.uid(), new.dibuat_oleh);
  end if;

  perform 1 from public.mutasi_unggahan
   where account_id = new.account_id and bank_id = new.bank_id
     and dibatalkan_at is null and selesai_at is null
     and created_at > now() - interval '15 minutes';
  if found then
    raise exception 'UNGGAHAN_BERJALAN: unggahan lain untuk rekening ini masih diproses. Tunggu sampai selesai (paling lama 15 menit), lalu ulangi.'
      using errcode = 'P0001';
  end if;

  new.recon_sebelum_saldo := b.recon_last_saldo;
  new.recon_sebelum_tgl := b.recon_last_date;
  new.recon_sesudah_saldo := b.recon_last_saldo;
  new.recon_sesudah_tgl := b.recon_last_date;
  return new;
end;
$$;

create or replace function public.batalkan_unggahan(p_unggah_id uuid, p_account_id uuid, p_oleh uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.mutasi_unggahan%rowtype;
  v_bank uuid;
  v_terbaru uuid;
  v_terpakai integer;
  v_hapus integer;
  v_cakupan integer;
  b public.banks%rowtype;
  v_sesudah_saldo numeric;
  v_sesudah_tgl date;
  v_recon text := 'tidak_diubah';
begin
  select bank_id into v_bank from public.mutasi_unggahan
   where id = p_unggah_id and account_id = p_account_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unggahan tidak ditemukan.');
  end if;
  -- Kunci banks DULU — urutan sama dengan pemicu sisip unggahan.
  select * into b from public.banks where id = v_bank and account_id = p_account_id for update;

  select * into u from public.mutasi_unggahan
   where id = p_unggah_id and account_id = p_account_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unggahan tidak ditemukan.');
  end if;
  if u.dibatalkan_at is not null then
    return jsonb_build_object('ok', false, 'error', 'Unggahan ini sudah dibatalkan.');
  end if;
  if u.selesai_at is null and u.created_at > now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'error',
      'Unggahan ini masih diproses. Tunggu sampai selesai, lalu muat ulang halaman.');
  end if;

  select id into v_terbaru from public.mutasi_unggahan
   where account_id = p_account_id and bank_id = u.bank_id and dibatalkan_at is null
   order by created_at desc, id desc
   limit 1;
  if v_terbaru is distinct from u.id then
    return jsonb_build_object('ok', false, 'error',
      'Hanya unggahan TERAKHIR rekening ini yang bisa dibatalkan.');
  end if;

  perform 1 from public.parsed_transactions
   where unggah_id = u.id and account_id = p_account_id and bank_id = u.bank_id
   for update;

  select count(*) into v_terpakai
    from public.parsed_transactions p
   where p.unggah_id = u.id and p.account_id = p_account_id and p.bank_id = u.bank_id
     and (p.claimed_by_input_id is not null
          or p.manual_claim_reason is not null
          or exists (select 1 from public.cek_inputs ci where ci.matched_tx_id = p.id));
  if v_terpakai > 0 then
    return jsonb_build_object('ok', false, 'terpakai', v_terpakai, 'error',
      v_terpakai || ' baris dari unggahan ini sudah dipakai pencocokan, jadi tidak bisa dibatalkan otomatis.');
  end if;

  delete from public.parsed_transactions
   where unggah_id = u.id and account_id = p_account_id and bank_id = u.bank_id;
  get diagnostics v_hapus = row_count;

  delete from public.mutasi_coverage
   where unggah_id = u.id and account_id = p_account_id and bank_id = u.bank_id;
  get diagnostics v_cakupan = row_count;

  -- Titik saldo SESUDAH unggahan ini: tercatat saat selesai, atau — bila
  -- prosesnya mati sebelum tanda selesai — titik penutup PDF-nya.
  if u.selesai_at is not null then
    v_sesudah_saldo := u.recon_sesudah_saldo;
    v_sesudah_tgl := u.recon_sesudah_tgl;
  else
    v_sesudah_saldo := u.target_saldo;
    v_sesudah_tgl := u.target_tgl;
  end if;

  if b.recon_last_saldo is not distinct from u.recon_sebelum_saldo
     and b.recon_last_date is not distinct from u.recon_sebelum_tgl then
    -- banks masih di titik sebelum unggahan ini: tidak ada yang perlu dikembalikan.
    v_recon := 'tidak_diubah';
  elsif v_sesudah_tgl is not null
     and (v_sesudah_tgl is distinct from u.recon_sebelum_tgl
          or v_sesudah_saldo is distinct from u.recon_sebelum_saldo) then
    if b.recon_last_saldo is not distinct from v_sesudah_saldo
       and b.recon_last_date is not distinct from v_sesudah_tgl then
      update public.banks
         set recon_last_saldo = u.recon_sebelum_saldo, recon_last_date = u.recon_sebelum_tgl
       where id = u.bank_id and account_id = p_account_id;
      v_recon := 'dikembalikan';
    else
      v_recon := 'sudah_berubah_lagi';
    end if;
  end if;

  update public.mutasi_unggahan
     set dibatalkan_at = now(),
         dibatalkan_oleh = p_oleh,
         catatan_batal = jsonb_build_object('baris_dihapus', v_hapus, 'cakupan_dihapus', v_cakupan, 'recon', v_recon)
   where id = u.id;

  return jsonb_build_object('ok', true, 'baris_dihapus', v_hapus, 'cakupan_dihapus', v_cakupan, 'recon', v_recon);
end;
$$;

revoke all on function public.batalkan_unggahan(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.batalkan_unggahan(uuid, uuid, uuid) to service_role;
revoke all on function public.mutasi_unggahan_sebelum_sisip() from public, anon, authenticated;
