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
module.exports = router;
