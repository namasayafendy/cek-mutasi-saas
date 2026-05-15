-- ============================================================
-- 0012: Bulk-claim RPC for parsed_transactions
-- ============================================================
--
-- Background: lib/sessions/save.ts used to UPDATE parsed_transactions
-- one row at a time inside a JS for-loop (one HTTP round-trip per row).
-- For a 276-match session this took ~93 seconds end-to-end. If the
-- user closed the tab or navigated away before the loop finished, only
-- a prefix of the rows ended up with claimed_by_input_id set, so the
-- /history Mutasi tab showed only the first ~30 rows highlighted.
--
-- Fix: a single SECURITY INVOKER function that takes a JSON array of
-- { tx_id, input_id } pairs and applies them in one atomic UPDATE.
-- RLS still applies (SECURITY INVOKER), so a user can only claim
-- transactions in their own account.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_parsed_transactions(
  claims jsonb
) RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_count int;
BEGIN
  IF claims IS NULL OR jsonb_typeof(claims) <> 'array' OR jsonb_array_length(claims) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.parsed_transactions pt
  SET claimed_by_input_id = (v->>'input_id')::uuid,
      claimed_at          = now()
  FROM jsonb_array_elements(claims) AS v
  WHERE pt.id = (v->>'tx_id')::uuid
    AND pt.claimed_by_input_id IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_parsed_transactions(jsonb) TO authenticated;
