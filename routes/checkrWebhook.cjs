const express = require("express");
const crypto = require("crypto");

const { getCheckrReport } = require("../services/checkrClient.cjs");
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
router.post("/webhook", async (req, res) => {
  if (!verifyCheckrSignature(req)) {
    return res.status(401).json({
      error: "Invalid Checkr webhook signature",
    });
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
