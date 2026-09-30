const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/auth.cjs");
const { requireStaff } = require("../middlewares/staffAuth.cjs");

const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

// Every Support Center endpoint must pass both authentication
// and GigRide staff authorization.
router.use(authMiddleware, requireStaff);

router.get("/me", (req, res) => {
  return res.json({
    ok: true,
    user_id: req.user.id,
    staff_role: req.staffProfile.staff_role,
  });
});

router.get("/bookings", async (req, res) => {
  try {
    const { data: bookings, error } = await supabaseAdmin
      .from("bookings")
      .select(`
        id,
        vehicle_id,
        driver_id,
        host_id,
        start_at,
        end_at,
        start_date,
        end_date,
        pickup_time,
        dropoff_time,
        rental_type,
        status,
        host_approved,
        created_at,
        deposit_paid,
        deposit_paid_at,
        payment_status,
        paid_at,
        insurance_status,
        dispute_status,
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        completed_at,
        vehicles:vehicle_id (
          id,
          year,
          make,
          model,
          trim,
          license_plate,
          plate_state,
          city,
          state,
          verification_status
        ),
        driver:driver_id (
          id,
          full_name,
          email,
          phone,
          identity_status,
          identity_verified,
          mvr_status
        ),
        host:host_id (
          id,
          full_name,
          email,
          phone
        )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("SUPPORT BOOKINGS ERROR:", error.message);
      return res.status(500).json({ error: "Unable to load bookings" });
    }

    return res.json({
      ok: true,
      bookings: bookings || [],
    });
  } catch (err) {
    console.error("SUPPORT BOOKINGS ERROR:", err);
    return res.status(500).json({ error: "Unable to load bookings" });
  }
});


router.get("/bookings/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select(`
        id,
        vehicle_id,
        driver_id,
        host_id,
        start_at,
        end_at,
        start_date,
        end_date,
        pickup_time,
        dropoff_time,
        rental_type,
        status,
        host_approved,
        created_at,
        deposit_paid,
        deposit_paid_at,
        payment_status,
        paid_at,
        refund_status,
        insurance_status,
        insurance_provider,
        dispute_status,
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        completed_at,
        pickup_mileage,
        return_mileage,
        pickup_odometer,
        return_odometer,
        damage_notes,
        vehicles:vehicle_id (
          id,
          year,
          make,
          model,
          trim,
          license_plate,
          plate_state,
          city,
          state,
          verification_status
        ),
        driver:driver_id (
          id,
          full_name,
          email,
          phone,
          identity_status,
          identity_verified,
          mvr_status
        ),
        host:host_id (
          id,
          full_name,
          email,
          phone
        )
      `)
      .eq("id", bookingId)
      .maybeSingle();

    if (error) {
      console.error("SUPPORT BOOKING DETAIL ERROR:", error.message);
      return res.status(500).json({ error: "Unable to load booking" });
    }

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    return res.json({
      ok: true,
      booking,
    });
  } catch (err) {
    console.error("SUPPORT BOOKING DETAIL ERROR:", err);
    return res.status(500).json({ error: "Unable to load booking" });
  }
});

module.exports = router;
