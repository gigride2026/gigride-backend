const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { notifyUser } = require("../utils/pushNotifications.cjs");

router.post("/insurance-submitted", async (req, res) => {
  try {
    console.log("INSURANCE SUBMITTED PUSH ROUTE HIT");

    const { booking_id, host_id, driver_id } = req.body || {};

    if (!booking_id) {
      return res.status(400).json({ error: "Missing booking_id" });
    }

    let hostId = host_id;

    if (!hostId) {
      const { data: booking, error: bookingError } = await supabaseAdmin
        .from("bookings")
        .select("id, host_id, driver_id")
        .eq("id", booking_id)
        .single();

      if (bookingError || !booking) {
        console.log("Booking lookup failed:", bookingError?.message);
        return res.status(404).json({ error: "Booking not found" });
      }

      hostId = booking.host_id;
    }

    if (!hostId) {
      return res.status(400).json({ error: "Missing host_id" });
    }

    await notifyUser({
      supabaseAdmin,
      userId: hostId,
      title: "Insurance Submitted",
      body: "A driver submitted insurance for review.",
      data: {
        type: "insurance_submitted",
        bookingId: booking_id,
        driverId: driver_id || null,
      },
    });

    return res.json({
      ok: true,
      message: "Insurance submitted notification attempted",
      booking_id,
      host_id: hostId,
    });
  } catch (err) {
    console.error("insurance-submitted notification error:", err);
    return res.status(500).json({
      error: err.message || "Failed to send insurance submitted notification",
    });
  }
});

module.exports = router;