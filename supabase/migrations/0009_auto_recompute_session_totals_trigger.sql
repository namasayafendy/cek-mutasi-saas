-- Trigger: auto-recompute cek_sessions totals whenever cek_inputs changes.
-- Fixes stale-totals bug where manual claim / group claim / delete didn't
-- refresh total_matched, total_unmatched, etc. on the session row
-- (visible at /history list view).

CREATE OR REPLACE FUNCTION public.recompute_session_totals_fn()
RETURNS TRIGGER AS $$
DECLARE
  sid uuid;
BEGIN
  -- Pick whichever side has the session_id (NEW for INSERT/UPDATE, OLD for DELETE)
  sid := COALESCE(NEW.session_id, OLD.session_id);
  IF sid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.cek_sessions s
  SET
    total_input = COALESCE(
      (SELECT count(*) FROM public.cek_inputs WHERE session_id = sid AND deleted_at IS NULL),
      0
    ),
    total_matched = COALESCE(
      (SELECT count(*) FROM public.cek_inputs
       WHERE session_id = sid AND match_status IN ('matched','manual_claimed') AND deleted_at IS NULL),
      0
    ),
    total_unmatched = COALESCE(
      (SELECT count(*) FROM public.cek_inputs
       WHERE session_id = sid AND match_status = 'no_candidate' AND deleted_at IS NULL),
      0
    ),
    total_conflict = COALESCE(
      (SELECT count(*) FROM public.cek_inputs
       WHERE session_id = sid AND match_status = 'all_taken' AND deleted_at IS NULL),
      0
    ),
    total_nominal_input = COALESCE(
      (SELECT sum(nominal) FROM public.cek_inputs WHERE session_id = sid AND deleted_at IS NULL),
      0
    ),
    total_nominal_matched = COALESCE(
      (SELECT sum(nominal) FROM public.cek_inputs
       WHERE session_id = sid AND match_status IN ('matched','manual_claimed') AND deleted_at IS NULL),
      0
    )
  WHERE s.id = sid;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS cek_inputs_recompute_session_totals ON public.cek_inputs;

CREATE TRIGGER cek_inputs_recompute_session_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.cek_inputs
  FOR EACH ROW EXECUTE FUNCTION public.recompute_session_totals_fn();

-- One-time: recompute all existing sessions' totals to clean up legacy drift.
UPDATE public.cek_sessions s
SET
  total_input = COALESCE(
    (SELECT count(*) FROM public.cek_inputs WHERE session_id = s.id AND deleted_at IS NULL),
    0
  ),
  total_matched = COALESCE(
    (SELECT count(*) FROM public.cek_inputs
     WHERE session_id = s.id AND match_status IN ('matched','manual_claimed') AND deleted_at IS NULL),
    0
  ),
  total_unmatched = COALESCE(
    (SELECT count(*) FROM public.cek_inputs
     WHERE session_id = s.id AND match_status = 'no_candidate' AND deleted_at IS NULL),
    0
  ),
  total_conflict = COALESCE(
    (SELECT count(*) FROM public.cek_inputs
     WHERE session_id = s.id AND match_status = 'all_taken' AND deleted_at IS NULL),
    0
  ),
  total_nominal_input = COALESCE(
    (SELECT sum(nominal) FROM public.cek_inputs WHERE session_id = s.id AND deleted_at IS NULL),
    0
  ),
  total_nominal_matched = COALESCE(
    (SELECT sum(nominal) FROM public.cek_inputs
     WHERE session_id = s.id AND match_status IN ('matched','manual_claimed') AND deleted_at IS NULL),
    0
  );
