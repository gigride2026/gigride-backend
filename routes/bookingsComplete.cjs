const express = require("express");
const router = express.Router();
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { calculateMileageCharge } = require("../utils/mileage.cjs");

function calculateLateFeeCents({
  endDate,
  dropoffTime,
  completedAt,
  dailyRateCents,
}) {
  if (!endDate || !dropoffTime || !completedAt) {
    return {
      late_fee_cents: 0,
      late_minutes: 0,
      late_label: "No late fee",
    };
  }

  const scheduledReturn = new Date(`${endDate} ${dropoffTime}`);
  const actualReturn = new Date(completedAt);

  if (Number.isNaN(scheduledReturn.getTime())) {
    return {
      late_fee_cents: 0,
      late_minutes: 0,
      late_label: "No late fee",
    };
  }

  const lateMinutes = Math.max(
    0,
    Math.floor((actualReturn.getTime() - scheduledReturn.getTime()) / 60000)
  );

  if (lateMinutes <= 30) {
    return {
      late_fee_cents: 0,
      late_minutes: lateMinutes,
      late_label: "Within 30 minute grace period",
    };
  }

  let fee = 0;
  let label = "";

  if (lateMinutes <= 120) {
    fee = Math.round(dailyRateCents * 0.25);
    label = "31 minutes–2 hours late";
  } else if (lateMinutes <= 360) {
    fee = Math.round(dailyRateCents * 0.5);
    label = "2–6 hours late";
  } else if (lateMinutes <= 1440) {
    fee = dailyRateCents;
    label = "6–24 hours late";
  } else {
    const extraDays = Math.ceil(lateMinutes / 1440);
    fee = dailyRateCents * extraDays;
    label = `${extraDays} extra day${extraDays > 1 ? "s" : ""} late`;
  }

  return {
    late_fee_cents: fee,
    late_minutes: lateMinutes,
    late_label: label,
  };
}

function normalizePhotoArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {
      return value.trim() ? [value.trim()] : [];
    }
  }

  return [];
}

router.post("/:id/complete", async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { end_odometer } = req.body;

    console.log(`🔥🔥🔥 NEW COMPLETE ROUTE HIT: ${bookingId}`);

    const endOdometerNum = Number(end_odometer);

    if (!Number.isFinite(endOdometerNum) || endOdometerNum < 0) {
      return res.status(400).json({ error: "end_odometer required" });
    }

    const { data: booking, error: bookingErr } = await supabaseAdmin
      .from("bookings")
      .select("*, vehicles:vehicle_id(*)")
      .eq("id", bookingId)
      .single();

    if (bookingErr || !booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const hostReturnPhotos = normalizePhotoArray(booking.host_return_photos);
    const driverReturnPhotos = normalizePhotoArray(booking.driver_return_photos);

    console.log(
      `COMPLETE PHOTO COUNTS booking=${bookingId} host=${hostReturnPhotos.length} driver=${driverReturnPhotos.length}`
    );

    if (hostReturnPhotos.length < 9 || driverReturnPhotos.length < 9) {
      return res.status(400).json({
        error: `Return photos missing. Host ${hostReturnPhotos.length}/9, Driver ${driverReturnPhotos.length}/9`,
      });
    }

    if (booking.status !== "active") {
      return res.status(400).json({
        error: `Booking must be active before completing trip. Current status: ${booking.status}`,
      });
    }

    const mileage = calculateMileageCharge({
      ...booking,
      end_odometer: endOdometerNum,
    });

    const dailyRateCents =
      Number(booking?.vehicles?.daily_rate_cents || 0) ||
      Math.round(Number(booking?.vehicles?.daily_price || 0) * 100);

    const completedAt = new Date().toISOString();

    const late = calculateLateFeeCents({
      endDate: booking.end_date,
      dropoffTime: booking.dropoff_time,
      completedAt,
      dailyRateCents,
    });

    console.log("LATE FEE DEBUG:", {
      bookingId,
      end_date: booking.end_date,
      dropoff_time: booking.dropoff_time,
      completedAt,
      dailyRateCents,
      late,
    });

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "completed",
        completed_at: completedAt,
        end_odometer: endOdometerNum,
        total_miles_driven: mileage.total_miles_driven,
        mileage_overage_miles: mileage.mileage_overage_miles,
        mileage_overage_cents: mileage.mileage_overage_cents,
        late_fee_cents: late.late_fee_cents,
        late_minutes: late.late_minutes,
        late_fee_label: late.late_label,
      })
      .eq("id", bookingId)
      .select("*")
      .single();

    if (updateErr) {
      return res.status(400).json({ error: updateErr.message });
    }

    return res.json({
      ok: true,
      booking: updated,
      mileage,
      late,
    });
  } catch (e) {
    console.log("COMPLETE TRIP ERROR:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

module.exports = router;