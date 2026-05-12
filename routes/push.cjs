const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { notifyUser } = require("../utils/pushNotifications.cjs");

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getUserFromReq(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;

  const token = auth.replace("Bearer ", "");
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) return null;
  return data.user;
}

router.post("/booking-approved", async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { bookingId, driverId } = req.body || {};

    if (!bookingId || !driverId) {
      return res.status(400).json({ error: "Missing bookingId or driverId" });
    }

    await notifyUser({
      supabaseAdmin,
      userId: driverId,
      title: "✅ Booking Approved",
      body: "Your booking was approved. Submit insurance, then pay your deposit and rental fees to secure the trip.",
      data: {
        type: "booking_approved",
        bookingId,
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("booking-approved push error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

router.post("/booking-requested", async (req, res) => {
  console.log("🔥 BOOKING REQUESTED PUSH ROUTE HIT:", req.body);

  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

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
      return res.status(404).json({ error: "Host not found for booking" });
    }

    const vehicle = booking.vehicles;
    const vehicleTitle = `${vehicle?.year || ""} ${vehicle?.make || ""} ${
      vehicle?.model || ""
    }`.trim() || "your vehicle";

    await notifyUser({
      supabaseAdmin,
      userId: booking.host_id,
      title: "New Booking Request",
      body: `Someone requested ${vehicleTitle}. Review it now.`,
      data: {
        type: "booking_requested",
        booking_id,
        vehicle_id: booking.vehicle_id,
        driver_id: booking.driver_id,
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("booking-requested push error:", e);
    return res.status(500).json({
      error: e.message || "Failed to send booking requested push",
    });
  }
});

module.exports = router;