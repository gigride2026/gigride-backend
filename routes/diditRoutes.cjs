const express = require("express");
const crypto = require("crypto");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { createDiditSession } = require("../services/diditClient.cjs");

const router = express.Router();

function normalizeStatus(payload) {
  return String(
    payload.status ||
      payload.session_status ||
      payload.verification_status ||
      payload.decision ||
      ""
  ).toLowerCase();
}

function isVerified(status) {
  return ["approved", "success", "verified", "completed"].includes(status);
}

function isFailed(status) {
  return ["declined", "rejected", "failed", "denied"].includes(status);
}

function verifyWebhookSignature(req) {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;

  if (!secret) return true;
  if (!req.rawBody) return false;

  const received =
    req.headers["x-signature"] ||
    req.headers["x-didit-signature"] ||
    req.headers["didit-signature"];

  if (!received) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("hex");

  const cleanReceived = String(received).replace("sha256=", "");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(cleanReceived)
    );
  } catch {
    return false;
  }
}

router.post("/session", async (req, res) => {
  try {
    const { profileId, email, role } = req.body;

    if (!profileId) {
      return res.status(400).json({ error: "Missing profileId" });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, is_host, is_driver")
      .eq("id", profileId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const session = await createDiditSession({
      profileId,
      email: email || profile.email,
      role: role || (profile.is_host ? "host" : "driver"),
    });

    await supabaseAdmin
      .from("profiles")
      .update({
        identity_provider: "didit",
        identity_status: "pending",
        identity_verified: false,
        didit_session_id: session.session_id || session.id || null,
        didit_session_token: session.session_token || null,
        didit_verification_url: session.url || session.verification_url || null,
        identity_updated_at: new Date().toISOString(),
      })
      .eq("id", profileId);

    return res.json({
      ok: true,
      session_id: session.session_id || session.id,
      session_token: session.session_token,
      verification_url: session.url || session.verification_url,
      raw: session,
    });
  } catch (err) {
    console.error("Didit session error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Didit session",
      details: err.response?.data || err.message,
    });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    const payload = req.body;
    const status = normalizeStatus(payload);

    const profileId =
      payload.vendor_data ||
      payload.metadata?.profile_id ||
      payload.profile_id;

    const sessionId =
      payload.session_id ||
      payload.id ||
      payload.verification_session_id ||
      null;

    if (!profileId) {
      return res.json({ received: true, ignored: true });
    }

    let identityStatus = "pending_review";
    let identityVerified = false;

    if (isVerified(status)) {
      identityStatus = "verified";
      identityVerified = true;
    } else if (isFailed(status)) {
      identityStatus = "failed";
      identityVerified = false;
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        identity_provider: "didit",
        identity_status: identityStatus,
        identity_verified: identityVerified,
        didit_session_id: sessionId,
        didit_last_status: status,
        didit_webhook_payload: payload,
        identity_updated_at: new Date().toISOString(),
      })
      .eq("id", profileId);

    if (error) {
      console.error("Didit webhook Supabase update error:", error);
      return res.status(500).json({ error: "Failed to update profile" });
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Didit webhook error:", err.message);
    return res.status(500).json({ error: "Webhook failed" });
  }
});

module.exports = router;