const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

async function sendExpoPushMessage(expoPushToken, title, body, data = {}) {
  const message = {
    to: expoPushToken,
    sound: "default",
    title,
    body,
    data,
  };

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  const text = await res.text();

  console.log("INSURANCE PUSH STATUS:", res.status);
  console.log("INSURANCE PUSH RESPONSE:", text);

  if (!res.ok) {
    throw new Error(`Expo push failed: ${text}`);
  }

  return text;
}

async function getPushTokenForUser(userId) {
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id, expo_push_token")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  return profile?.expo_push_token || null;
}

router.post("/insurance-submitted", async (req, res) => {
  try {
    const { booking_id } = req.body || {};

    if (!booking_id) {
      return res.status(400).json({ error: "Missing booking_id" });
    }

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select(`
        id,
        host_id,
        driver_id,
        vehicle_id,
        insurance_company,
        vehicles (
          year,
          make,
          model
        )
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (error) throw error;

    if (!booking?.host_id) {
      return res.status(404).json({ error: "Host not found for booking." });
    }

    const hostPushToken = await getPushTokenForUser(booking.host_id);

    if (!hostPushToken) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "No expo_push_token found for host.",
      });
    }

    const vehicle = booking.vehicles;
    const vehicleTitle = `${vehicle?.year || ""} ${vehicle?.make || ""} ${
      vehicle?.model || ""
    }`.trim() || "a vehicle";

    await sendExpoPushMessage(
      hostPushToken,
      "Insurance Submitted",
      `A driver submitted insurance for ${vehicleTitle}. Review it before deposit unlock.`,
      {
        type: "insurance_submitted",
        booking_id,
        driver_id: booking.driver_id,
        vehicle_id: booking.vehicle_id,
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("INSURANCE SUBMITTED PUSH ERROR:", e);
    return res.status(500).json({
      error: e.message || "Failed to send insurance submitted push.",
    });
  }
});

router.post("/insurance-approved", async (req, res) => {
  try {
    const { user_id, booking_id } = req.body || {};

    if (!user_id) {
      return res.status(400).json({ error: "Missing user_id" });
    }

    const expoPushToken = await getPushTokenForUser(user_id);

    if (!expoPushToken) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "No expo_push_token found for user.",
      });
    }

    await sendExpoPushMessage(
      expoPushToken,
      "Insurance Approved",
      "Your insurance was approved. You can now pay your deposit.",
      {
        type: "insurance_approved",
        user_id,
        booking_id,
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("INSURANCE APPROVED PUSH ERROR:", e);
    return res.status(500).json({
      error: e.message || "Failed to send insurance approved push.",
    });
  }
});

router.post("/insurance-rejected", async (req, res) => {
  try {
    const { user_id, booking_id } = req.body || {};

    if (!user_id) {
      return res.status(400).json({ error: "Missing user_id" });
    }

    const expoPushToken = await getPushTokenForUser(user_id);

    if (!expoPushToken) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "No expo_push_token found for user.",
      });
    }

    await sendExpoPushMessage(
      expoPushToken,
      "Insurance Needs Review",
      "Your insurance was not approved. Please upload an updated document.",
      {
        type: "insurance_rejected",
        user_id,
        booking_id,
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("INSURANCE REJECTED PUSH ERROR:", e);
    return res.status(500).json({
      error: e.message || "Failed to send insurance rejected push.",
    });
  }
});

module.exports = router;