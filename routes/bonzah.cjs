const express = require("express");
const router = express.Router();

const {
  getBonzahToken,
  bonzahPremiumCalc,
  bonzahQuote,
} = require("../services/bonzahClient.cjs");

router.get("/test", async (req, res) => {
  try {
    const token = await getBonzahToken();

    res.json({
      ok: true,
      token,
    });
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});

router.get("/master", async (req, res) => {
  try {
    const token = await getBonzahToken();
    const axios = require("axios");

    const response = await axios.get(
      `${process.env.BONZAH_API_URL}/api/v1/Bonzah/master`,
      {
        headers: {
          "in-auth-token": token,
          "Content-Type": "application/json",
        },
        params: {
          master_name: "country",
          values: "country",
          filter: "",
          filter_value: "",
        },
      }
    );

    res.json(response.data);
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});

router.post("/premium", async (req, res) => {
  try {
    const data = await bonzahPremiumCalc(req.body);
    res.json(data);
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});
router.get("/premium-test", async (req, res) => {
  try {
    const data = await bonzahPremiumCalc({
      trip_start_date: "06/15/2026",
      trip_end_date: "06/22/2026",
      pickup_country: "United States",
      pickup_state: "GA",
      drop_off_time: "Same",
      cdw_cover: true,
      rcli_cover: true,
      sli_cover: false,
      pai_cover: false,
      skip_validation: true,
    });

    res.json(data);
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});

router.post("/quote", async (req, res) => {
  try {
    const data = await bonzahQuote(req.body);
    res.json(data);
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});
router.post("/booking/:bookingId/premium", async (req, res) => {
  try {
    const { bookingId } = req.params;

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select(`
        id,
        start_at,
        end_at,
        start_date,
        end_date,
        vehicle_id,
        vehicles (
          id,
          state,
          pickup_state,
          location_state
        )
      `)
      .eq("id", bookingId)
      .maybeSingle();

    if (error || !booking) {
      return res.status(404).json({
        ok: false,
        error: "Booking not found",
      });
    }

    const startDate = booking.start_at || booking.start_date;
    const endDate = booking.end_at || booking.end_date;

    const pickupState =
      booking.vehicles?.pickup_state ||
      booking.vehicles?.location_state ||
      booking.vehicles?.state ||
      "GA";

    const formatBonzahDate = (value) => {
      const d = new Date(value);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    };

    const payload = {
      trip_start_date: formatBonzahDate(startDate),
      trip_end_date: formatBonzahDate(endDate),
      pickup_country: "United States",
      pickup_state: pickupState,
      drop_off_time: "Same",
      cdw_cover: true,
      rcli_cover: true,
      sli_cover: false,
      pai_cover: false,
      skip_validation: true,
    };

    console.log("🛡️ Bonzah booking premium payload:", payload);

    const data = await bonzahPremiumCalc(payload);

    res.json({
      ok: true,
      bookingId,
      payload,
      bonzah: data,
    });
  } catch (e) {
    console.error("❌ Bonzah booking premium failed:", e);
    res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

module.exports = router;