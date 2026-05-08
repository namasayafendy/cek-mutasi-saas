-- Phase 6: kalau user di-invite (raw_user_meta_data.invited_to_account_id ada),
-- link ke account inviter sebagai staff bukan bikin account baru.

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_account_id uuid;
  existing_count int;
  invited_account uuid;
BEGIN
  SELECT COUNT(*) INTO existing_count FROM public.team_members WHERE user_id = NEW.id;
  IF existing_count > 0 THEN
    UPDATE public.team_members SET joined_at = COALESCE(joined_at, now()) WHERE user_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Cek apakah user di-invite (metadata di-set di auth.admin.inviteUserByEmail)
  invited_account := NULLIF(NEW.raw_user_meta_data->>'invited_to_account_id', '')::uuid;

  IF invited_account IS NOT NULL THEN
    -- Pastikan account exists (defense-in-depth, harusnya pasti ada karena owner yang invite)
    IF EXISTS (SELECT 1 FROM public.accounts WHERE id = invited_account) THEN
      INSERT INTO public.team_members (account_id, user_id, role, invited_at, joined_at)
      VALUES (invited_account, NEW.id, 'staff', now(), NULL);
      RETURN NEW;
    END IF;
  END IF;

  -- Default: signup standalone, bikin account baru sebagai owner
  INSERT INTO public.accounts (owner_user_id, status, trial_ends_at)
  VALUES (NEW.id, 'trial', now() + interval '7 days')
  RETURNING id INTO new_account_id;

  INSERT INTO public.team_members (account_id, user_id, role, joined_at)
  VALUES (new_account_id, NEW.id, 'owner', now());

  INSERT INTO public.account_settings (account_id) VALUES (new_account_id);

  RETURN NEW;
END;
$$;
