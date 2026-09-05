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
  )
    .trim()
    .toLowerCase();
}

function isVerified(status) {
  return ["approved", "success", "verified", "completed"].includes(status);
}

function isFailed(status) {
  return ["declined", "rejected", "failed", "denied"].includes(status);
}

function normalizeFeatureStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getDiditFeatures(payload) {
  return (
    payload?.changes?.features?.current ||
    payload?.features ||
    {}
  );
}

function diditFeaturesVerified(payload) {
  const features = getDiditFeatures(payload);

  const required = [
    features.ID_VERIFICATION,
    features.LIVENESS,
    features.FACE_MATCH,
  ];

  return required.every(
    (value) => normalizeFeatureStatus(value) === "approved"
  );
}

function getRejectedDiditFeatures(payload) {
  const features = getDiditFeatures(payload);

  return Object.entries(features)
    .filter(([, value]) => {
      const status = normalizeFeatureStatus(value);

      return [
        "declined",
        "rejected",
        "failed",
        "denied",
      ].includes(status);
    })
    .map(([name]) => name);
}

function verifyWebhookSignature(req) {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;

  if (!secret) {
    console.error("DIDIT_WEBHOOK_SECRET missing");
    return false;
  }

  if (!req.rawBody) {
    console.error("Didit webhook rawBody missing");
    return false;
  }

  const received =
    req.headers["x-signature"] ||
    req.headers["x-didit-signature"] ||
    req.headers["didit-signature"];

  if (!received) {
    console.error("Didit webhook signature header missing");
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("hex");

  const cleanReceived = String(received)
    .replace("sha256=", "")
    .trim();

  try {
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(cleanReceived);

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      expectedBuffer,
      receivedBuffer
    );
  } catch (err) {
    console.error("Didit signature comparison error:", err.message);
    return false;
  }
}

router.post("/session", async (req, res) => {
  try {
    const { profileId, email, role } = req.body;

    if (!profileId) {
      return res.status(400).json({
        error: "Missing profileId",
      });
    }

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select(
          [
            "id",
            "email",
            "is_host",
            "is_driver",
            "identity_status",
            "identity_verified",
            "didit_session_id",
            "didit_session_token",
            "didit_verification_url",
          ].join(",")
        )
        .eq("id", profileId)
        .single();

    if (profileError || !profile) {
      console.error(
        "Didit profile lookup error:",
        profileError
      );

      return res.status(404).json({
        error: "Profile not found",
      });
    }

    if (
      profile.identity_verified === true ||
      profile.identity_status === "verified"
    ) {
      return res.json({
        ok: true,
        alreadyVerified: true,
        message: "Identity already verified.",
      });
    }

    if (
      profile.identity_status === "pending_review" ||
      profile.identity_status === "pending"
    ) {
      return res.json({
        ok: true,
        alreadyPending: true,
        message: "Identity verification is already in progress.",
        session_id: profile.didit_session_id || null,
        session_token: profile.didit_session_token || null,
        verification_url:
          profile.didit_verification_url || null,
      });
    }

    const session = await createDiditSession({
      profileId,
      email: email || profile.email,
      role:
        role ||
        (profile.is_host ? "host" : "driver"),
    });

    const sessionId =
      session.session_id ||
      session.id ||
      null;

    const sessionToken =
      session.session_token ||
      session.token ||
      null;

    const verificationUrl =
      session.url ||
      session.verification_url ||
      null;

    const now = new Date().toISOString();

    const { error: updateError } =
      await supabaseAdmin
        .from("profiles")
        .update({
          identity_provider: "didit",
          identity_status: "pending",
          identity_verified: false,
          identity_rejected_reason: null,
          didit_session_id: sessionId,
          didit_session_token: sessionToken,
          didit_verification_url: verificationUrl,
          didit_last_status: "created",
          identity_updated_at: now,
        })
        .eq("id", profileId);

    if (updateError) {
      console.error(
        "Didit session profile update error:",
        updateError
      );

      return res.status(500).json({
        error: "Failed to save Didit session",
      });
    }

    return res.json({
      ok: true,
      session_id: sessionId,
      session_token: sessionToken,
      verification_url: verificationUrl,
      raw: session,
    });
  } catch (err) {
    console.error(
      "Didit session error:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      error: "Failed to create Didit session",
      details:
        err.response?.data ||
        err.message,
    });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({
        error: "Invalid webhook signature",
      });
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
      console.warn(
        "Didit webhook ignored because profileId was missing"
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "missing_profile_id",
      });
    }

    // Get the user's current identity state first.
    // This prevents later ACTIVE/informational webhooks
    // from downgrading someone who is already verified.
    const { data: existingProfile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select(
          "id, identity_status, identity_verified, identity_verified_at, didit_session_id"
        )
        .eq("id", profileId)
        .single();

    if (profileError || !existingProfile) {
      console.error(
        "Didit webhook profile lookup error:",
        profileError
      );

      return res.status(404).json({
        error: "Profile not found",
      });
    }

    const features = getDiditFeatures(payload);

    const featuresVerified =
      diditFeaturesVerified(payload);

    const rejectedFeatures =
      getRejectedDiditFeatures(payload);

    let identityStatus =
      existingProfile.identity_status || "pending_review";

    let identityVerified =
      existingProfile.identity_verified === true;

    let identityVerifiedAt =
      existingProfile.identity_verified_at || null;

    let identityRejectedReason = null;

    /*
      Didit may send:
      status = ACTIVE

      while the feature results already show:
      ID_VERIFICATION = Approved
      LIVENESS = Approved
      FACE_MATCH = Approved

      Feature approval therefore takes priority.
    */
    if (
      featuresVerified ||
      isVerified(status)
    ) {
      identityStatus = "verified";
      identityVerified = true;

      // Preserve the original verification timestamp
      identityVerifiedAt =
        existingProfile.identity_verified_at ||
        new Date().toISOString();

      identityRejectedReason = null;
    } else if (
      !existingProfile.identity_verified &&
      (
        rejectedFeatures.length > 0 ||
        isFailed(status)
      )
    ) {
      /*
        Only mark rejected if the user has NOT already
        been successfully verified.

        This protects verified accounts from being
        downgraded by a later webhook.
      */
      identityStatus = "rejected";
      identityVerified = false;

      identityRejectedReason =
        rejectedFeatures.length > 0
          ? `Didit rejected: ${rejectedFeatures.join(", ")}`
          : `Didit status: ${status}`;
    } else if (!existingProfile.identity_verified) {
      /*
        No approval and no definitive failure yet.
        Keep the user pending.
      */
      identityStatus = "pending_review";
      identityVerified = false;
    }

    const now = new Date().toISOString();

    const updateData = {
      identity_provider: "didit",
      identity_status: identityStatus,
      identity_verified: identityVerified,
      didit_last_status: status || null,
      didit_webhook_payload: payload,
      identity_updated_at: now,
      identity_rejected_reason:
        identityRejectedReason,
    };

    // Do not overwrite a stored session ID with null.
    if (sessionId) {
      updateData.didit_session_id = sessionId;
    }

    // Only store this once verification has actually occurred.
    if (identityVerifiedAt) {
      updateData.identity_verified_at =
        identityVerifiedAt;
    }

    const { data: updatedProfiles, error } =
      await supabaseAdmin
        .from("profiles")
        .update(updateData)
        .eq("id", profileId)
        .select(
          "id, email, identity_status, identity_verified, identity_verified_at, didit_last_status"
        );

    if (error) {
      console.error(
        "Didit webhook Supabase update error:",
        error
      );

      return res.status(500).json({
        error: "Failed to update profile",
      });
    }

    if (
      !updatedProfiles ||
      updatedProfiles.length === 0
    ) {
      console.error(
        "Didit webhook profile not found:",
        profileId
      );

      return res.status(404).json({
        error: "Profile not found",
      });
    }

    console.log("Didit webhook processed", {
      profileId,
      webhookType: payload.webhook_type || null,
      topLevelStatus: status,
      features,
      featuresVerified,
      rejectedFeatures,
      finalIdentityStatus: identityStatus,
      finalIdentityVerified: identityVerified,
    });

    return res.json({
      received: true,
      profile_id: profileId,
      identity_status: identityStatus,
      identity_verified: identityVerified,
    });
  } catch (err) {
    console.error(
      "Didit webhook error:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      error: "Webhook failed",
    });
  }
});

module.exports = router;