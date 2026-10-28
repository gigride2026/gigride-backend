const express = require("express");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const authMiddleware = require("../middlewares/auth.cjs");
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
router.get("/test-connection", async (req, res) => {
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
router.post("/start-screening", async (req, res) => {
  try {
    const driverId = req.user?.id;
const driverEmail = String(req.user?.email || "").trim();

if (!driverEmail) {
  return res.status(400).json({
    error: "A valid account email is required for background screening.",
    code: "DRIVER_EMAIL_REQUIRED",
  });
}

  let screeningClaimed = false;
  let candidateCreated = false;
  let candidateSaved = false;
  let invitationCreated = false;
  let invitationSaved = false;
    if (!driverId) {
      return res.status(401).json({
        error: "Driver authentication required.",
      });
    }

    const backgroundCheck = await getDriverBackgroundCheck(
      supabaseAdmin,
      driverId
    );
const { data: driverProfile, error: profileError } =
  await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", driverId)
    .single();

if (profileError || !driverProfile?.full_name?.trim()) {
  return res.status(400).json({
    error: "Please complete your profile name before screening.",
    code: "DRIVER_NAME_REQUIRED",
  });
}

const nameParts = driverProfile.full_name.trim().split(/\s+/);

const firstName = nameParts.shift();
const lastName = nameParts.join(" ");

if (!firstName || !lastName) {
  return res.status(400).json({
    error: "Please enter your first and last name before screening.",
    code: "DRIVER_FULL_NAME_REQUIRED",
  });
}
if (
  backgroundCheck?.status === "initiating" ||
  backgroundCheck?.checkr_candidate_id ||
  backgroundCheck?.checkr_invitation_id ||
  backgroundCheck?.checkr_report_id ||
  backgroundCheck?.screening_started_at
) {
  return res.status(409).json({
    error: "A background check has already been initiated for this driver.",
    code: "SCREENING_ALREADY_STARTED",
  });
}
    if (backgroundCheck?.fee_payment_status !== "paid") {
      return res.status(403).json({
error: "The $39.49 screening fee (including MVR) must be paid first.",
        code: "SCREENING_PAYMENT_REQUIRED",
      });
    }
return res.status(503).json({
  error: "Screening initiation is not yet enabled.",
  code: "SCREENING_NOT_ENABLED",
});
const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
  "claim_driver_screening",
  { p_driver_id: driverId }
);

if (claimError) {
  throw claimError;
}

if (claimed !== true) {
  return res.status(409).json({
    error: "Screening has already been claimed or is not eligible to start.",
    code: "SCREENING_CLAIM_FAILED",
  });
}


screeningClaimed = true;

const candidate = await createCheckrCandidate({
  firstName,
  lastName,
  email: driverEmail,
});

if (!candidate?.id) {
  throw new Error("Checkr did not return a candidate ID.");
}
candidateCreated = true;

const { data: savedCandidate, error: saveCandidateError } =
  await supabaseAdmin
    .from("driver_background_checks")
    .update({
      checkr_candidate_id: candidate.id,
      updated_at: new Date().toISOString(),
    })
    .eq("driver_id", driverId)
    .eq("status", "initiating")
    .is("checkr_candidate_id", null)
    .select("id")
    .single();

if (saveCandidateError || !savedCandidate) {
  throw new Error("Unable to save Checkr candidate ID.");
}

candidateSaved = true;

const invitation = await createCheckrInvitation({
  candidateId: candidate.id,
});

if (!invitation?.id) {
  throw new Error("Checkr did not return an invitation ID.");
}
invitationCreated = true;

const { data: savedInvitation, error: saveInvitationError } =
  await supabaseAdmin
    .from("driver_background_checks")
    .update({
      checkr_invitation_id: invitation.id,
      updated_at: new Date().toISOString(),
    })
    .eq("driver_id", driverId)
    .eq("status", "initiating")
    .eq("checkr_candidate_id", candidate.id)
    .is("checkr_invitation_id", null)
    .select("id")
    .single();

if (saveInvitationError || !savedInvitation) {
  throw new Error("Unable to save Checkr invitation ID.");
}

invitationSaved = true;

    return res.status(200).json({
      success: true,
      status: "invitation_created",
      message: "Checkr screening invitation created successfully.",
    });
  } catch (error) {
    console.error("CHECKR START ERROR:", error.message);
console.error("CHECKR SCREENING PROGRESS:", {
  screeningClaimed,
  candidateCreated,
  candidateSaved,
  invitationCreated,
  invitationSaved,
});

if (screeningClaimed) {
  return res.status(409).json({
    error:
      "Background screening initiation was interrupted. Please contact GigRide support before trying again.",
    code: "SCREENING_REQUIRES_REVIEW",
  });
}

return res.status(500).json({
  error: "Unable to initiate background screening.",
  code: "SCREENING_INITIATION_FAILED",
});
  }
});

// Record the authenticated driver's explicit screening acknowledgment.
// This is not formal Checkr background-check authorization.
router.post("/acknowledge-screening", async (req, res) => {
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
router.get("/my-screening", async (req, res) => {
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
