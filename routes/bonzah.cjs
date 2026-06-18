const express = require("express");
const router = express.Router();
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

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
  master_name: "state",
  values: "state",
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
  trip_start_date: "06/19/2026",
  trip_end_date: "06/20/2026",
  pickup_country: "United States",
  pickup_state: "GA",
  residence_country: "United States",
  residence_state: "GA",
  drop_off_time: "10:00 AM",
  cdw_cover: true,
  rcli_cover: true,
  sli_cover: false,
  pai_cover: false,
  skip_validation: false,
});

    res.json(data);
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});
router.get("/state-test", async (req, res) => {
  const combos = [
    { country: "United States", state: "GA" },
    { country: "United States", state: "Georgia" },
    { country: "US", state: "GA" },
    { country: "USA", state: "GA" },
    { country: "United States of America", state: "GA" },
    { country: "US", state: "Georgia" },
    { country: "USA", state: "Georgia" },
  ];

  const results = [];

  for (const combo of combos) {
    try {
      const data = await bonzahPremiumCalc({
        trip_start_date: "06/19/2026",
        trip_end_date: "06/20/2026",
        pickup_country: combo.country,
        pickup_state: combo.state,
        residence_country: combo.country,
        residence_state: combo.state,
        drop_off_time: "Same",
        cdw_cover: true,
        rcli_cover: true,
        sli_cover: false,
        pai_cover: false,
        skip_validation: false,
      });

      results.push({ combo, response: data });
    } catch (e) {
      results.push({
        combo,
        error: e.message,
        data: e.response?.data || null,
      });
    }
  }

  res.json(results);
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
  .select("*")
  .eq("id", bookingId)
  .maybeSingle();

  console.log("🛡️ Bonzah bookingId:", bookingId);
console.log("🛡️ Bonzah booking lookup:", booking);
console.log("🛡️ Bonzah booking error:", error);

    if (error || !booking) {
      return res.status(404).json({
        ok: false,
        error: "Booking not found",
      });
    }

    const startDate = booking.start_at || booking.start_date;
    const endDate = booking.end_at || booking.end_date;

    const formatBonzahDate = (value) => {
  const d = new Date(value);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
};

    const {
  cdw_cover = true,
  rcli_cover = true,
  sli_cover = false,
  pai_cover = false,
} = req.body || {};

const payload = {
  trip_start_date: formatBonzahDate(startDate),
  trip_end_date: formatBonzahDate(endDate),

  pickup_country: "United States",
  pickup_state: "Georgia",

  residence_country: "United States",
  residence_state: "Georgia",

  drop_off_time: "Same",

  cdw_cover,
  rcli_cover,
  sli_cover,
  pai_cover,

  skip_validation: false,
};


    console.log("🛡️ Bonzah booking premium payload:", payload);
console.log("🛡️ PREMIUM PAYLOAD JSON:", JSON.stringify(payload, null, 2));
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

router.post("/booking/:bookingId/quote", async (req, res) => {
  try {
    const { bookingId } = req.params;

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !booking) {
      return res.status(404).json({
        ok: false,
        error: "Booking not found",
      });
    }

    const { data: vehicle, error: vehicleError } = await supabaseAdmin
      .from("vehicles")
      .select("*")
      .eq("id", booking.vehicle_id)
      .maybeSingle();

    if (vehicleError || !vehicle) {
      return res.status(404).json({
        ok: false,
        error: "Vehicle not found",
      });
    }

    const startDate = booking.start_at || booking.start_date;
    const endDate = booking.end_at || booking.end_date;

    const formatBonzahDateTime = (value) => {
      const d = new Date(value);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();

      return `${mm}/${dd}/${yyyy} 10:00:00`;
    };

    const {
      cdw_cover = true,
      rcli_cover = true,
      sli_cover = false,
      pai_cover = false,
      finalize = 0,
    } = req.body || {};

    const payload = {
      trip_start_date: formatBonzahDateTime(startDate),
      trip_end_date: formatBonzahDateTime(endDate),

      pickup_country: "United States",
      pickup_state: "Georgia",
      drop_off_time: "Same",

      residence_country: "United States",
      residence_state: "Georgia",

      cdw_cover,
      rcli_cover,
      sli_cover,
      pai_cover,

      first_name: "Greg",
      last_name: "Jones",
      dob: "01/01/1988",
      pri_email_address: "greg@test.com",

      address_line_1: "123 Main Street",
      city: "Atlanta",
      state: "Georgia",
      zip_code: "30303",
      country: "United States",

      inspection_done: "Rental Agency",
      source: "API",
      phone_no: "14705551234",

      year: Number(vehicle.year) || 2025,
      make: vehicle.make || "KIA",
      model: vehicle.model || "K4",
      vehicle_vin: vehicle.vin || undefined,

      policy_booking_time_zone: "America/New_York",
      finalize,
    };

    console.log("🛡️ Bonzah booking quote payload:", payload);
    console.log("🛡️ QUOTE PAYLOAD JSON:", JSON.stringify(payload, null, 2));

    const data = await bonzahQuote(payload);

    const quoteId = data?.data?.quote_id || null;
    const premium =
      data?.data?.total_premium ||
      data?.data?.total_amount ||
      data?.data?.total_due ||
      null;

    if (data?.status === 0 && quoteId) {
      await supabaseAdmin
        .from("bookings")
        .update({
          bonzah_quote_id: quoteId,
          bonzah_premium: premium,
          bonzah_total_due: premium,
          bonzah_selected_coverages: {
            cdw_cover,
            rcli_cover,
            sli_cover,
            pai_cover,
          },
        })
        .eq("id", bookingId);
    }

    res.json({
      ok: true,
      bookingId,
      payload,
      bonzah: data,
    });
  } catch (e) {
    console.error("❌ Bonzah booking quote failed:", e);
    res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

module.exports = router;