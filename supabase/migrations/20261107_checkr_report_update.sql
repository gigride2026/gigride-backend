CREATE OR REPLACE FUNCTION public.apply_checkr_report_update(p_candidate_id text, p_report_id text, p_report_status text, p_report_result text, p_completed_at timestamp with time zone, p_revised_at timestamp with time zone, p_report_assessment text, p_includes_canceled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_record public.driver_background_checks%ROWTYPE;
  v_status text;
  v_result text;
  v_assessment text;
  v_same_report boolean;
BEGIN
  IF NULLIF(TRIM(p_candidate_id), '') IS NULL
     OR NULLIF(TRIM(p_report_id), '') IS NULL
     OR p_report_status IS NULL
     OR p_report_status NOT IN
       ('pending', 'complete', 'suspended', 'disputed', 'canceled')
  THEN
    RAISE EXCEPTION 'Invalid Checkr report details';
  END IF;

  v_assessment := NULLIF(TRIM(p_report_assessment), '');

  IF v_assessment IS NOT NULL
     AND v_assessment NOT IN ('eligible', 'review', 'escalated')
  THEN
    RAISE EXCEPTION 'Unsupported Checkr assessment';
  END IF;

  IF p_report_status = 'complete'
     AND v_assessment IS NULL
     AND (
       p_report_result IS NULL
       OR p_report_result NOT IN ('clear', 'consider')
     )
  THEN
    RAISE EXCEPTION 'Unsupported completed Checkr result';
  END IF;

  SELECT *
  INTO v_record
  FROM public.driver_background_checks
  WHERE checkr_candidate_id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkr candidate not found';
  END IF;

  IF v_record.checkr_report_id IS NOT NULL
     AND v_record.checkr_report_id <> p_report_id
  THEN
    RAISE EXCEPTION 'Checkr report does not match candidate';
  END IF;

  IF v_record.fee_payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Screening fee has not been paid';
  END IF;

  v_status := CASE
    WHEN p_report_status = 'canceled'
      THEN 'review_required'
    WHEN p_report_status = 'complete'
         AND p_includes_canceled IS DISTINCT FROM false
      THEN 'review_required'
    WHEN p_report_status = 'complete'
         AND v_assessment = 'eligible'
      THEN 'clear'
    WHEN p_report_status = 'complete'
         AND v_assessment IN ('review', 'escalated')
      THEN 'review_required'
    WHEN p_report_status = 'complete'
         AND v_assessment IS NULL
         AND p_report_result = 'clear'
      THEN 'clear'
    WHEN p_report_status = 'complete'
         AND v_assessment IS NULL
         AND p_report_result = 'consider'
      THEN 'review_required'
    ELSE p_report_status
  END;

  v_result := CASE
    WHEN p_report_status = 'complete'
      THEN p_report_result
    ELSE NULL
  END;

  v_same_report :=
    v_record.checkr_report_id = p_report_id
    AND v_record.checkr_report_status
        IS NOT DISTINCT FROM p_report_status
    AND v_record.checkr_report_result
        IS NOT DISTINCT FROM v_result
    AND v_record.checkr_report_assessment
        IS NOT DISTINCT FROM v_assessment
    AND v_record.checkr_includes_canceled
        IS NOT DISTINCT FROM p_includes_canceled;

  IF v_record.checkr_report_revised_at IS NOT NULL
     AND (
       p_revised_at IS NULL
       OR p_revised_at < v_record.checkr_report_revised_at
     )
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'stale', true,
      'status', v_record.status
    );
  END IF;

  IF v_record.report_conflict_hold
     AND (
       p_revised_at IS NULL
       OR v_record.checkr_report_revised_at IS NULL
       OR p_revised_at <= v_record.checkr_report_revised_at
     )
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'held', true,
      'status', v_record.status
    );
  END IF;

  IF (
       v_record.checkr_report_revised_at IS NOT NULL
       AND p_revised_at = v_record.checkr_report_revised_at
       AND NOT v_same_report
     )
     OR (
       v_record.checkr_report_id IS NOT NULL
       AND v_record.checkr_report_revised_at IS NULL
       AND p_revised_at IS NULL
       AND NOT v_same_report
     )
  THEN
    UPDATE public.driver_background_checks
    SET
      status = 'review_required',
      report_conflict_hold = true,
      review_decision = NULL,
      reviewed_by = NULL,
      reviewed_at = NULL,
      review_notes = NULL,
      updated_at = pg_catalog.now()
    WHERE id = v_record.id;

    RETURN pg_catalog.jsonb_build_object(
      'conflict', true,
      'status', 'review_required'
    );
  END IF;

  IF v_same_report
     AND p_revised_at IS NOT DISTINCT FROM
         v_record.checkr_report_revised_at
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'duplicate', true,
      'status', v_record.status
    );
  END IF;

  UPDATE public.driver_background_checks
  SET
    checkr_report_id = p_report_id,
    checkr_report_status = p_report_status,
    checkr_report_result = v_result,
    checkr_report_assessment = v_assessment,
    checkr_includes_canceled = p_includes_canceled,
    checkr_report_revised_at = COALESCE(
      p_revised_at,
      v_record.checkr_report_revised_at
    ),
    report_conflict_hold = false,
    status = v_status,
    screening_completed_at = CASE
      WHEN p_report_status = 'complete'
        THEN COALESCE(p_completed_at, pg_catalog.now())
      ELSE NULL
    END,
    review_decision = NULL,
    reviewed_by = NULL,
    reviewed_at = NULL,
    review_notes = NULL,
    updated_at = pg_catalog.now()
  WHERE id = v_record.id;

  RETURN pg_catalog.jsonb_build_object(
    'updated', true,
    'status', v_status
  );
END;
$function$;
