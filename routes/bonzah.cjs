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
  drop_off_time: "Same",
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

  first_name: "Greg",
  last_name: "Jones",
  date_of_birth: "01/01/1988",
  address_line_1: "123 Main Street",
  city: "Atlanta",
  state: "Georgia",
  zip_code: "30303",
  country: "United States",
  email: "greg@test.com",
  phone_no: "4705551234",

  cdw_cover,
  rcli_cover,
  sli_cover,
  pai_cover,

  skip_validation: false,
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