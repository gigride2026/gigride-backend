const express = require("express");
const router = express.Router();
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

const PAYPAL_BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || "Failed to get PayPal token");
  }

  return data.access_token;
}

router.get("/test", (req, res) => {
  res.json({
    ok: true,
    message: "PayPal route connected",
    env: process.env.PAYPAL_ENV,
    hasClientId: !!process.env.PAYPAL_CLIENT_ID,
    hasSecret: !!process.env.PAYPAL_CLIENT_SECRET,
  });
});

router.post("/create-order", async (req, res) => {
  try {
    const { booking_id, amount, payment_type } = req.body;

    if (!booking_id || !amount || !payment_type) {
      return res.status(400).json({
        error: "booking_id, amount, and payment_type are required",
      });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: booking_id,
            description: `GigRide ${payment_type} payment`,
            amount: {
              currency_code: "USD",
              value: Number(amount).toFixed(2),
            },
            custom_id: `${booking_id}:${payment_type}`,
          },
        ],
        application_context: {
          brand_name: "GigRide",
          user_action: "PAY_NOW",
          return_url: "gigride://paypal-success",
          cancel_url: "gigride://paypal-cancel",
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data });
    }

    const approvalUrl = data.links?.find((l) => l.rel === "approve")?.href;

    res.json({
      ok: true,
      order_id: data.id,
      approval_url: approvalUrl,
      raw: data,
    });
  } catch (err) {
    console.error("PayPal create-order error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/capture-order", async (req, res) => {
  try {
    const { order_id, booking_id, payment_type } = req.body;

    if (!order_id || !booking_id || !payment_type) {
      return res.status(400).json({
        error: "order_id, booking_id, and payment_type are required",
      });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${PAYPAL_BASE}/v2/checkout/orders/${order_id}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data });
    }

    const update = {};

    if (payment_type === "deposit") {
      update.status = "deposit_paid";
      update.deposit_paid = true;
      update.deposit_paid_at = new Date().toISOString();
    }

    if (payment_type === "rental") {
      update.payment_status = "paid";
      update.paid_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from("bookings")
      .update(update)
      .eq("id", booking_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      ok: true,
      message: "Payment captured and booking updated",
      paypal: data,
    });
  } catch (err) {
    console.error("PayPal capture-order error:", err);
    res.status(500).json({ error: err.message });
  }
});

'module.exports = router;'