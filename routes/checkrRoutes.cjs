const express = require("express");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const authMiddleware = require("../middlewares/auth.cjs");
const { requireOwner } = require("../middlewares/staffAuth.cjs");
const {
  getCheckrAccount,
  createCheckrCandidate,
  createCheckrInvitation,
} = require("../services/checkrClient.cjs");

const {
  getDriverBackgroundCheck,
  isRentalScreeningEligible,
} = require("../services/driverBackgroundChecks.cjs");
const router = express.Router();

// All Checkr endpoints require authentication.
router.use(authMiddleware);

// Safe connection test: does not initiate a background check.
router.get("/status", async (req, res) => {
  try {

    return res.json({
      configured: Boolean(process.env.CHECKR_API_KEY),
      message: "Checkr route is working",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to check Checkr configuration",
    });
  }
});



// Authenticated Checkr API connection test (read-only)
router.get("/test-connection", requireOwner, async (req, res) => {
  try {
    const account = await getCheckrAccount();

    return res.json({
      connected: true,
      message: "Checkr API connection successful",
      accountId: account.id,
    });
  } catch (error) {
    console.error("Checkr connection test failed:", error.message);

    return res.status(502).json({
      connected: false,
      message: "Checkr API connection failed",
    });
  }
});
// First-time driver screening: payment and authorization are required.
// Checkr's hosted invitation flow will collect driver information and consent.
// Screening initiation remains disabled until invitation handling is complete.
router.post("/start-screening", authMiddleware, (req, res) => {
  return res.status(503).json({
    error: "Screening initiation is managed by the automated worker and is not yet enabled.",
    code: "SCREENING_NOT_ENABLED",
  });
});

// Record the authenticated driver's explicit screening acknowledgment.
// This is not formal Checkr background-check authorization.
router.post("/acknowledge-screening", authMiddleware, async (req, res) => {
  try {
    const driverId = req.user?.id;

    if (!driverId) {
      return res.status(401).json({ error: "Authentication required." });
    }

    if (req.body?.acknowledged !== true) {
      return res.status(400).json({
        error: "Explicit screening acknowledgment is required.",
        code: "SCREENING_ACKNOWLEDGMENT_REQUIRED",
      });
    }

    const bookingId = req.body?.booking_id;

    if (
      typeof bookingId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId)
    ) {
      return res.status(400).json({
        error: "A valid booking ID is required.",
        code: "SCREENING_BOOKING_REQUIRED",
      });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id")
      .eq("id", bookingId)
      .eq("driver_id", driverId)
      .eq("host_approved", true)
      .maybeSingle();

    if (bookingError) throw bookingError;

    if (!booking) {
      return res.status(403).json({
        error: "An approved booking belonging to this driver is required.",
        code: "SCREENING_BOOKING_NOT_APPROVED",
      });
    }

    const { data: screening, error: lookupError } = await supabaseAdmin
      .from("driver_background_checks")
      .select("screening_acknowledged_at")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (!screening) {
      const { error: insertError } = await supabaseAdmin
        .from("driver_background_checks")
        .upsert(
          {
            driver_id: driverId,
            first_booking_id: bookingId,
            screening_acknowledged_at: new Date().toISOString(),
            fee_amount_cents: 3949,
            fee_payment_status: "unpaid",
            status: "not_started",
          },
          {
            onConflict: "driver_id",
            ignoreDuplicates: true,
          }
        );

      if (insertError) throw insertError;

      const { data: confirmed, error: confirmError } = await supabaseAdmin
        .from("driver_background_checks")
        .select("screening_acknowledged_at")
        .eq("driver_id", driverId)
        .maybeSingle();

      if (confirmError) throw confirmError;

      if (confirmed?.screening_acknowledged_at) {
        return res.json({
          acknowledged: true,
          already_recorded: false,
        });
      }

      return res.status(409).json({
        error: "Screening acknowledgment could not be confirmed. Please retry.",
        code: "SCREENING_ACKNOWLEDGMENT_NOT_CONFIRMED",
      });
    }

    if (screening.screening_acknowledged_at) {
      return res.json({
        acknowledged: true,
        already_recorded: true,
      });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("driver_background_checks")
      .update({
        screening_acknowledged_at: new Date().toISOString(),
      })
      .eq("driver_id", driverId)
      .is("screening_acknowledged_at", null)
      .select("screening_acknowledged_at")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updated?.screening_acknowledged_at) {
      return res.status(409).json({
        error: "Screening acknowledgment could not be confirmed. Please retry.",
        code: "SCREENING_ACKNOWLEDGMENT_NOT_CONFIRMED",
      });
    }

    return res.json({
      acknowledged: true,
      already_recorded: false,
    });
  } catch (error) {
    console.error("SCREENING ACKNOWLEDGMENT ERROR:", error.message);
    return res.status(500).json({
      error: "Unable to record screening acknowledgment.",
    });
  }
});

// Read-only screening status for the authenticated driver.
router.get("/my-screening", authMiddleware, async (req, res) => {
  try {
    const driverId = req.user?.id;

    if (!driverId) {
      return res.status(401).json({ error: "Authentication required." });
    }
    const screening = await getDriverBackgroundCheck(supabaseAdmin, driverId);

    if (!screening) {
      return res.json({
        screening_required: true,
        fee_paid: false,
        fee_pending: false,
        screening_acknowledged: false,
        screening_status: "not_started",
        rental_eligible: false,
      });
    }

    const invitationStatus = screening.checkr_invitation_status;
    const invitationExpiresAt = screening.checkr_invitation_expires_at;

    const expirationTime = invitationExpiresAt
      ? Date.parse(invitationExpiresAt)
      : null;

    const invitationIsValid =
      invitationStatus === "pending" &&
      (!invitationExpiresAt ||
        (Number.isFinite(expirationTime) &&
          expirationTime > Date.now()));

    return res.json({
      screening_required: true,
      fee_paid: screening.fee_payment_status === "paid",
      fee_pending: screening.fee_payment_status === "pending",
      screening_acknowledged: Boolean(screening.screening_acknowledged_at),
      screening_status: screening.status,
checkr_invitation_url: invitationIsValid
  ? screening.checkr_invitation_url ?? null
  : null,
      checkr_invitation_status: screening.checkr_invitation_status ?? null,
      checkr_invitation_expires_at: screening.checkr_invitation_expires_at ?? null,
      rental_eligible: isRentalScreeningEligible(screening),
    });
  } catch (error) {
    console.error("SCREENING STATUS ERROR:", error.message);
    return res.status(500).json({
      error: "Unable to retrieve screening status.",
    });
  }
});

module.exports = router;
