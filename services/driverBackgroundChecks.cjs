const SCREENING_FEE_CENTS = 3949;
async function getDriverBackgroundCheck(supabaseAdmin, driverId) {
  if (!driverId) {
    throw new Error("driverId is required");
  }

  const { data, error } = await supabaseAdmin
    .from("driver_background_checks")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
function isRentalScreeningEligible(screening) {
  if (!screening) return false;

  const feePaid = screening.fee_payment_status === "paid";
  const hasCheckrReport = Boolean(
    String(screening.checkr_report_id || "").trim()
  );
  const reportComplete = screening.checkr_report_status === "complete";
  const noConflict = screening.report_conflict_hold === false;

  const automaticallyCleared =
    screening.status === "clear" &&
    screening.checkr_report_result === "clear";

  const ownerApproved =
    screening.status === "review_required" &&
    screening.checkr_report_result === "consider" &&
    screening.review_decision === "approved" &&
    Boolean(screening.reviewed_by) &&
    Boolean(screening.reviewed_at);

  return (
    feePaid &&
    hasCheckrReport &&
    reportComplete &&
    noConflict &&
    (automaticallyCleared || ownerApproved)
  );
}

module.exports = {
  SCREENING_FEE_CENTS,
  getDriverBackgroundCheck,
isRentalScreeningEligible,
};

function needsScreeningFee(record) {
  if (!record) return true;

  const paymentStatus = String(record.fee_payment_status || "").toLowerCase();

  if (["paid", "pending", "refunded"].includes(paymentStatus)) {
    return false;
  }

  return true;
}
async function reserveDriverScreeningFee(
  supabaseAdmin,
  driverId,
  bookingId
) {
  if (!driverId || !bookingId) {
    throw new Error("Driver ID and booking ID are required");
  }

  const { data, error } = await supabaseAdmin.rpc(
    "reserve_driver_screening_fee",
    {
      p_driver_id: driverId,
      p_booking_id: bookingId,
    }
  );

  if (error) {
    throw error;
  }

  const reservation = Array.isArray(data) ? data[0] : data;

  if (!reservation?.reservation_id) {
    throw new Error("Screening fee reservation was not created");
  }

  return reservation;
}

module.exports.reserveDriverScreeningFee = reserveDriverScreeningFee;

module.exports.needsScreeningFee = needsScreeningFee;
