const express = require("express");
const Stripe = require("stripe");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { notifyAdmin } = require("../utils/pushNotifications.cjs");

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

router.post("/create-session", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "Missing auth token" });
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return res.status(401).json({ error: "Invalid user token" });
    }

    const verificationSession =
  await stripe.identity.verificationSessions.create({
    type: "document",
    options: {
      document: {
        require_matching_selfie: true,
      },
    },
    metadata: {
      user_id: user.id,
      email: user.email || "",
    },
    return_url: "gigride://identity-complete",
  });

    await supabaseAdmin
      .from("profiles")
      .update({
        identity_status: "pending_review",
        identity_submitted_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    return res.json({
      ok: true,
      url: verificationSession.url,
      verification_session_id: verificationSession.id,
    });
  } catch (e) {
    console.error("Stripe Identity error:", e);
    return res.status(500).json({
      error: e.message || "Failed to create identity session",
    });
  }
});

module.exports = router;