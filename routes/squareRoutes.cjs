const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

const SQUARE_BASE_URL =
  process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

router.post("/create-payment-link", async (req, res) => {
  try {
    const { booking_id, payment_type, amount_cents } = req.body;

    if (!booking_id || !payment_type || !amount_cents) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const idempotencyKey = crypto.randomUUID();

    const response = await fetch(`${SQUARE_BASE_URL}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Square-Version": "2025-04-16",
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        quick_pay: {
          name:
            payment_type === "deposit"
              ? `GigRide Deposit - ${booking_id}`
              : `GigRide Rental Payment - ${booking_id}`,
          price_money: {
            amount: Number(amount_cents),
            currency: "USD",
          },
          location_id: process.env.SQUARE_LOCATION_ID,
        },
        checkout_options: {
          redirect_url: process.env.APP_DEEP_LINK || "gigride://square-success",
        },
        pre_populated_data: {},
        payment_note: JSON.stringify({
          booking_id,
          payment_type,
        }),
      }),
    });

    const text = await response.text();
    let json = text ? JSON.parse(text) : {};

    console.log("SQUARE PAYMENT LINK STATUS:", response.status);
    console.log("SQUARE PAYMENT LINK RESPONSE:", json);

    if (!response.ok) {
      return res.status(response.status).json({
        error: json?.errors?.[0]?.detail || "Failed to create Square payment link",
        square: json,
      });
    }

    return res.json({
      payment_link_id: json?.payment_link?.id,
      checkout_url: json?.payment_link?.url,
    });
  } catch (e) {
    console.error("SQUARE CREATE PAYMENT LINK ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;