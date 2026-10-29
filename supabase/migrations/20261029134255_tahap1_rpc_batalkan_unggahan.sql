-- TAHAP 1 — "Batalkan unggahan" sebagai SATU transaksi.
-- Diterapkan lewat MCP apply_migration 29 Okt 2026 (versi 20261029134255).
-- Dipanggil HANYA oleh server action (service_role) sesudah memastikan
-- pemanggilnya pemilik akun. Aturan:
--   * hanya unggahan TERAKHIR (belum dibatalkan) per rekening — unggahan yang
--     lebih baru bisa saja bergantung pada baris unggahan ini;
--   * DITOLAK utuh bila ada satu saja barisnya yang sudah dipakai pencocokan
--     (diklaim, klaim manual, atau ditunjuk cek_inputs.matched_tx_id) —
--     membatalkan sebagian akan meninggalkan buku yang tak bisa dijelaskan;
--   * titik saldo bank dikembalikan HANYA bila belum digeser unggahan lain;
--   * vonis yang sudah terkirim ke Aceh Gadai TIDAK ikut dibatalkan (di luar
--     database ini) — layar wajib mengatakannya.
create or replace function public.batalkan_unggahan(p_unggah_id uuid, p_account_id uuid, p_oleh uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.mutasi_unggahan%rowtype;
  v_terbaru uuid;
  v_terpakai integer;
  v_hapus integer;
  v_cakupan integer;
  b public.banks%rowtype;
  v_recon text := 'tidak_diubah';
begin
  select * into u from public.mutasi_unggahan
   where id = p_unggah_id and account_id = p_account_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unggahan tidak ditemukan.');
  end if;
  if u.dibatalkan_at is not null then
    return jsonb_build_object('ok', false, 'error', 'Unggahan ini sudah dibatalkan.');
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
   where unggah_id = u.id and account_id = p_account_id
   for update;

  select count(*) into v_terpakai
    from public.parsed_transactions p
   where p.unggah_id = u.id and p.account_id = p_account_id
     and (p.claimed_by_input_id is not null
          or p.manual_claim_reason is not null
          or exists (select 1 from public.cek_inputs ci where ci.matched_tx_id = p.id));
  if v_terpakai > 0 then
    return jsonb_build_object('ok', false, 'terpakai', v_terpakai, 'error',
      v_terpakai || ' baris dari unggahan ini sudah dipakai pencocokan, jadi tidak bisa dibatalkan otomatis.');
  end if;

  delete from public.parsed_transactions where unggah_id = u.id and account_id = p_account_id;
  get diagnostics v_hapus = row_count;

  delete from public.mutasi_coverage where unggah_id = u.id and account_id = p_account_id;
  get diagnostics v_cakupan = row_count;

  if u.recon_sesudah_tgl is distinct from u.recon_sebelum_tgl
     or u.recon_sesudah_saldo is distinct from u.recon_sebelum_saldo then
    select * into b from public.banks where id = u.bank_id and account_id = p_account_id for update;
    if b.recon_last_saldo is not distinct from u.recon_sesudah_saldo
       and b.recon_last_date is not distinct from u.recon_sesudah_tgl then
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
