const express = require("express");
const router = express.Router();
const supabaseAdmin = require("../utils/supabaseAdmin.cjs");

router.post("/:id/start", async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { start_odometer } = req.body;

    if (!start_odometer) {
      return res.status(400).json({ error: "start_odometer required" });
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "active",
        start_odometer: Number(start_odometer),
      })
      .eq("id", bookingId)
      .select("*")
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ ok: true, booking: data });
  } catch (e) {
    console.log("START TRIP ERROR:", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;