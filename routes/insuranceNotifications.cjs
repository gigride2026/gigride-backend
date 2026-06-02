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
  try {
  const json = JSON.parse(text);
  console.log("EXPO PUSH JSON:", JSON.stringify(json, null, 2));
} catch {
  console.log("EXPO PUSH RAW:", text);
}

  return text;
}
async function getPushTokensForUser(userId) {
  const { data, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("expo_push_token")
    .eq("user_id", userId);

  if (error) throw error;

  return data || [];
}

router.post("/insurance-submitted", async (req, res) => {
  try {
    const { booking_id, host_id, driver_id } = req.body || {};

    if (!booking_id && !host_id) {
      return res.status(400).json({ error: "Missing booking_id or host_id" });
    }

    let booking = null;

    if (booking_id) {
      const { data, error } = await supabaseAdmin
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
      booking = data;
    }

    const targetHostId = booking?.host_id || host_id;

    if (!targetHostId) {
      return res.status(404).json({ error: "Host not found for booking." });
    }

    const hostPushTokens = await getPushTokensForUser(targetHostId);

console.log("INSURANCE SUBMITTED BODY:", req.body);
console.log("TARGET HOST ID:", targetHostId);
console.log("HOST PUSH TOKENS:", hostPushTokens);

if (!hostPushTokens || hostPushTokens.length === 0) {
  return res.status(200).json({
    ok: true,
    skipped: true,
    reason: "No push tokens found for host.",
    targetHostId,
  });
}

    const vehicle = booking?.vehicles;
    const vehicleTitle = `${vehicle?.year || ""} ${vehicle?.make || ""} ${
      vehicle?.model || ""
    }`.trim() || "a vehicle";

   for (const row of hostPushTokens) {
  await sendExpoPushMessage(
    row.expo_push_token,
      "Insurance Submitted",
      `A driver submitted insurance for your ${vehicleTitle}. Review it before deposit unlock.`,
      {
        type: "insurance_submitted",
        booking_id,
        driver_id: booking?.driver_id || driver_id,
        vehicle_id: booking?.vehicle_id,
      }
      );
}

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

    const pushTokens = await getPushTokensForUser(user_id);

    console.log("INSURANCE APPROVED USER:", user_id);
    console.log("INSURANCE APPROVED TOKENS:", pushTokens);

    if (!pushTokens || pushTokens.length === 0) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "No push tokens found for user.",
      });
    }

    for (const row of pushTokens) {
      await sendExpoPushMessage(
        row.expo_push_token,
        "Insurance Approved",
        "Your insurance was approved. You can now pay your deposit.",
        {
          type: "insurance_approved",
          user_id,
          booking_id,
        }
      );
    }

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

    const pushTokens = await getPushTokensForUser(user_id);

    console.log("INSURANCE REJECTED USER:", user_id);
    console.log("INSURANCE REJECTED TOKENS:", pushTokens);

    if (!pushTokens || pushTokens.length === 0) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "No push tokens found for user.",
      });
    }

    for (const row of pushTokens) {
      await sendExpoPushMessage(
        row.expo_push_token,
        "Insurance Needs Review",
        "Your insurance was not approved. Please upload an updated document.",
        {
          type: "insurance_rejected",
          user_id,
          booking_id,
        }
      );
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("INSURANCE REJECTED PUSH ERROR:", e);

    return res.status(500).json({
      error: e.message || "Failed to send insurance rejected push.",
    });
  }
});

module.exports = router;