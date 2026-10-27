
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { startDriverScreening } = require("./startDriverScreening.cjs");

async function processPaidScreenings() {
  // Never process screenings unless explicitly enabled.
  if (process.env.CHECKR_SCREENING_WORKER_ENABLED !== "true") {
    return {
      enabled: false,
      processed: 0,
      message: "Checkr screening worker is disabled",
    };
  }

  // The initiation service has its own independent safety switch.
  if (process.env.CHECKR_SCREENING_INITIATION_ENABLED !== "true") {
    return {
      enabled: false,
      processed: 0,
      message: "Checkr screening initiation is disabled",
    };
  }

  const { data: screenings, error } = await supabaseAdmin
    .from("driver_background_checks")
    .select("driver_id")
    .eq("fee_payment_status", "paid")
    .eq("status", "not_started")
    .is("screening_started_at", null)
    .is("checkr_candidate_id", null)
    .is("checkr_invitation_id", null)
    .is("checkr_report_id", null)
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) throw error;

  let processed = 0;

  for (const screening of screenings || []) {
    try {
      await startDriverScreening(screening.driver_id);
      processed += 1;
    } catch (error) {
      console.error("CHECKR SCREENING WORKER ERROR:", {
        driverId: screening.driver_id,
        message: error.message,
      });

      // Stop instead of automatically retrying a potentially
      // partially created Checkr candidate or invitation.
      break;
    }
  }

  return {
    enabled: true,
    processed,
  };
}

module.exports = { processPaidScreenings };
