const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
router.get("/test", (req, res) => {
  res.json({ ok: true, route: "stripe connect working" });
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

console.log(
  "STRIPE MODE:",
  process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
    ? "LIVE"
    : "TEST"
);

/**
 * POST /api/stripe-connect/onboard-host
 */
router.post("/onboard-host", async (req, res) => {
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

    const hostId = user.id;
    const hostEmail = user.email || undefined;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, stripe_account_id")
      .eq("id", hostId)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    let stripeAccountId = profile?.stripe_account_id;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: hostEmail,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: {
          host_id: hostId,
          platform: "gigride",
        },
      });

      stripeAccountId = account.id;

      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({
          stripe_account_id: stripeAccountId,
          stripe_account_type: "express",
        })
        .eq("id", hostId);

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }
    }

    const baseUrl =
      process.env.APP_BASE_URL || "https://gigride.app";

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${baseUrl}/stripe/refresh`,
      return_url: `${baseUrl}/stripe/return`,
      type: "account_onboarding",
    });

    return res.json({
      ok: true,
      url: accountLink.url,
      stripe_account_id: stripeAccountId,
    });
  } catch (e) {
    console.error("Stripe Connect onboarding error:", e);
    return res.status(500).json({
      error: e.message || "Failed to start Stripe onboarding",
    });
  }
});

/**
 * GET /api/stripe-connect/status
 */
router.get("/status", async (req, res) => {
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

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id, stripe_account_type")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    if (!profile?.stripe_account_id) {
      return res.json({
        connected: false,
        payouts_enabled: false,
        details_submitted: false,
      });
    }

    const account = await stripe.accounts.retrieve(
      profile.stripe_account_id
    );

    return res.json({
      connected: true,
      stripe_account_id: profile.stripe_account_id,
      payouts_enabled: !!account.payouts_enabled,
      charges_enabled: !!account.charges_enabled,
      details_submitted: !!account.details_submitted,
      requirements: account.requirements,
    });
  } catch (e) {
    console.error("Stripe Connect status error:", e);
    return res.status(500).json({
      error: e.message || "Failed to get Stripe status",
    });
  }
});

module.exports = router;