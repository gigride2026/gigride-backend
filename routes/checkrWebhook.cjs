const express = require("express");
const crypto = require("crypto");

const { getCheckrReport, getCheckrInvitation } = require("../services/checkrClient.cjs");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

const router = express.Router();

function getCheckrReportId(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const eventType = payload.type;

if (
  eventType !== "report.completed" &&
  eventType !== "report.updated" &&
  eventType !== "report.engaged" &&
  eventType !== "report.dispute_completed"
) {
  return null;
}
  const reportId = payload.data?.object?.id;

  if (typeof reportId !== "string" || !reportId.trim()) {
    return null;
  }

  return reportId.trim();
}

function getCheckrExpiredInvitationId(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.type !== "invitation.expired"
  ) {
    return null;
  }

  const invitationId = payload.data?.object?.id;

  if (typeof invitationId !== "string" || !invitationId.trim()) {
    return null;
  }

  return invitationId.trim();
}

async function verifyExpiredCheckrInvitation(invitationId) {
  const invitation = await getCheckrInvitation(invitationId);

  if (
    !invitation ||
    invitation.id !== invitationId ||
    invitation.status !== "expired" ||
    typeof invitation.candidate_id !== "string" ||
    !invitation.candidate_id.trim()
  ) {
    throw new Error("Checkr expired invitation verification failed");
  }

  return {
    invitationId,
    candidateId: invitation.candidate_id.trim(),
    expiresAt: invitation.expires_at ?? null,
  };
}

function verifyCheckrSignature(req) {
  const apiKey = process.env.CHECKR_API_KEY;
  const signature = req.headers["x-checkr-signature"];

  if (!apiKey || !signature || !Buffer.isBuffer(req.rawBody)) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", apiKey)
    .update(req.rawBody)
    .digest();

  const receivedHex = String(signature).trim();

  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) {
    return false;
  }

  const received = Buffer.from(receivedHex, "hex");

  return crypto.timingSafeEqual(expected, received);
}
async function processExpiredCheckrInvitation(invitationId) {
  const verified = await verifyExpiredCheckrInvitation(invitationId);

  const { data: screening, error: lookupError } = await supabaseAdmin
    .from("driver_background_checks")
    .select("id, checkr_candidate_id, checkr_invitation_id, checkr_report_id")
    .eq("checkr_candidate_id", verified.candidateId)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  if (!screening) {
    throw new Error("No GigRide screening matches Checkr candidate");
  }

  if (screening.checkr_invitation_id !== verified.invitationId) {
    throw new Error("Checkr invitation does not match stored screening");
  }

  const { data, error } = await supabaseAdmin.rpc(
    "apply_checkr_invitation_expiration",
    {
      p_candidate_id: verified.candidateId,
      p_invitation_id: verified.invitationId,
      p_expires_at: verified.expiresAt,
    }
  );

  if (error) {
    throw error;
  }

  if (!data || typeof data.updated !== "boolean") {
    throw new Error("Invalid invitation expiration update response");
  }

  return data;
}

router.post("/webhook", async (req, res) => {
  if (!verifyCheckrSignature(req)) {
    return res.status(401).json({
      error: "Invalid Checkr webhook signature",
    });
  }

  const invitationId = getCheckrExpiredInvitationId(req.body);

  if (invitationId) {
    try {
      const result = await processExpiredCheckrInvitation(invitationId);

      return res.status(200).json({
        ok: true,
        processed: result.updated,
      });
    } catch (error) {
      console.error("Checkr invitation expiration failed:", error.message);

      return res.status(503).json({
        error: "Unable to verify Checkr invitation expiration",
      });
    }
  }

  const reportId = getCheckrReportId(req.body);

if (reportId) {
  try {
    const report = await getCheckrReport(reportId);

    if (report.id !== reportId) {
      throw new Error("Checkr report ID mismatch");
    }
const candidateId = report.candidate_id;

if (!candidateId || typeof candidateId !== "string") {
  throw new Error("Checkr report missing candidate ID");
}

const { data: screening, error: lookupError } =
  await supabaseAdmin
    .from("driver_background_checks")
    .select("id, driver_id, checkr_candidate_id, checkr_report_id, status")
    .eq("checkr_candidate_id", candidateId)
    .maybeSingle();

if (lookupError) {
  throw lookupError;
}

if (!screening) {
  throw new Error("No GigRide screening matches Checkr candidate");
}

if (
  screening.checkr_report_id &&
  screening.checkr_report_id !== reportId
) {
  throw new Error("Checkr report does not match stored screening");
}

console.log("Checkr report matched to GigRide screening:", {
  screeningId: screening.id,
  reportId,
});

    console.log("Checkr report verified:", {
      reportId: report.id,
      status: report.status,
      result: report.result,
    });
const { data: screeningStatus, error: updateError } =
  await supabaseAdmin.rpc("apply_checkr_report_update", {
    p_candidate_id: candidateId,
    p_report_id: reportId,
    p_report_status: report.status,
    p_report_result: report.result ?? null,
    p_completed_at: report.completed_at ?? null,
    p_revised_at: report.revised_at ?? null,
  });

if (updateError) {
  throw updateError;
}

console.log("Checkr screening updated:", {
  screeningId: screening.id,
  reportId,
  status: screeningStatus,
});

  } catch (error) {
    console.error("Checkr report lookup failed:", error.message);

    return res.status(503).json({
      error: "Unable to verify Checkr report",
    });
  }
}
return res.status(200).json({
  ok: true,
  processed: Boolean(reportId),
});
});

module.exports = router;
