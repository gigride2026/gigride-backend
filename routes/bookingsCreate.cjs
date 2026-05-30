const express = require("express");
const router = express.Router();
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { getMileageSnapshot } = require("../utils/mileage.cjs");
function tripDays(startDate, endDate) {
  if (!startDate || !endDate) return 1;

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 1;
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.ceil((end.getTime() - start.getTime()) / msPerDay);

  return Math.max(1, diff);
}

router.post("/", async (req, res) => {
  try {
    const {
      vehicle_id,
      host_id,
      driver_id,
      rental_type,
      start_date,
      end_date,
      unlimited_miles_selected,
      total_price_cents,
      pickup_time,
      dropoff_time,
    } = req.body;

    // 🔍 fetch vehicle mileage settings
    const { data: vehicle, error: vehicleErr } = await supabaseAdmin
      .from("vehicles")
      .select("*")
      .eq("id", vehicle_id)
      .single();

    if (vehicleErr || !vehicle) {
      return res.status(404).json({ error: "Vehicle not found" });
    }

    // 📊 mileage snapshot
    const mileage = getMileageSnapshot({
      rentalType: rental_type,
      vehicle,
      unlimitedSelected: unlimited_miles_selected,
    });

    const protectionFeeDailyCents = Number(
  vehicle.insurance_enabled
    ? vehicle.insurance_protection_fee_cents || 399
    : 0
);

const insuranceTotalCents =
  protectionFeeDailyCents * tripDays(start_date, end_date);

const finalTotal =
  Number(total_price_cents || 0) +
  Number(mileage.unlimited_miles_fee_cents || 0) +
  insuranceTotalCents;

   const { data: bookingConflicts, error: bookingConflictError } = await supabaseAdmin
  .from("bookings")
  .select("id,start_date,end_date,status")
  .eq("vehicle_id", vehicle_id)
  .in("status", [
    "requested",
    "pending",
    "deposit_paid",
    "pickup_confirmed",
    "active",
  ])
  .lte("start_date", end_date)
  .gte("end_date", start_date);

if (bookingConflictError) {
  return res.status(500).json({
    error: bookingConflictError.message,
  });
}

if (bookingConflicts?.length) {
  return res.status(400).json({
    error: "Vehicle is unavailable for selected dates.",
  });
}

const { data: blockedDates, error: blockedDatesError } = await supabaseAdmin
  .from("vehicle_unavailable_dates")
  .select("id,start_date,end_date")
  .eq("vehicle_id", vehicle_id)
  .lte("start_date", end_date)
  .gte("end_date", start_date);

if (blockedDatesError) {
  return res.status(500).json({
    error: blockedDatesError.message,
  });
}

if (blockedDates?.length) {
  return res.status(400).json({
    error: "Vehicle is blocked by the host for selected dates.",
  });
}
const authHeader = req.headers.authorization || "";

const token = authHeader.replace("Bearer ", "");

const {
  data: { user },
  error: authError,
} = await supabaseAdmin.auth.getUser(token);

if (authError || !user) {
  return res.status(401).json({
    error: "Unauthorized",
  });
}

const driverId = user.id;

      // 💾 insert booking
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .insert({
        vehicle_id,
        host_id,
        driver_id: driverId,
        rental_type,
        start_date,
        end_date,
        total_price_cents: finalTotal,
        insurance_provider: vehicle.insurance_enabled
  ? vehicle.insurance_provider || "abi"
  : null,

insurance_protection_fee_cents: protectionFeeDailyCents,

insurance_total_cents: insuranceTotalCents,
        status: "requested",
        metadata: { is_test: true },
        pickup_time,
        dropoff_time,

        ...mileage,
      })
      .select("*")
      .single();

    
         if (error) {
      return res.status(400).json({ error: error.message });
    }

    // 💬 create conversation for host/driver messaging
    const { error: conversationError } = await supabaseAdmin
      .from("conversations")
      .upsert(
        {
          booking_id: data.id,
          driver_id: data.driver_id,
          host_id: data.host_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "booking_id" }
      );

    if (conversationError) {
      console.log("CREATE CONVERSATION ERROR:", conversationError.message);
    }

        return res.json({ ok: true, booking: data });
  } catch (e) {
    console.log("CREATE BOOKING ERROR:", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;