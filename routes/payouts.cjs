const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { releasePayouts } = require("../jobs/releasePayouts.cjs");

/**
 * =========================================
 * POST /api/payouts/:payoutId/mark-paid
 * =========================================
 */
router.post("/:payoutId/mark-paid", async (req, res) => {
  try {
    const payoutId = String(req.params.payoutId || "").trim();

    if (!payoutId) {
      return res.status(400).json({ error: "payout id required" });
    }

    // 🔍 Fetch payout first
    const { data: payout, error: payoutFetchError } = await supabaseAdmin
      .from("host_payouts")
      .select("*")
      .eq("id", payoutId)
      .maybeSingle();

    if (payoutFetchError) {
      console.error("❌ payout fetch error:", payoutFetchError);
      return res.status(500).json({ error: payoutFetchError.message });
    }

    if (!payout) {
      return res.status(404).json({ error: "Payout not found" });
    }

    // 🚫 Already paid
    if (String(payout.status || "").toLowerCase() === "paid") {
      return res.status(400).json({ error: "Payout already paid" });
    }

    // 🚫 Not yet available
    if (payout.payout_available_at) {
      const availableAtMs = new Date(payout.payout_available_at).getTime();
      const nowMs = Date.now();

      if (!Number.isNaN(availableAtMs) && availableAtMs > nowMs) {
        return res.status(400).json({
          error: "Payout not yet available",
        });
      }
    }

    // ✅ Mark as paid
    const paidAt = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("host_payouts")
      .update({
        status: "paid",
        paid_at: paidAt,
      })
      .eq("id", payoutId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("❌ mark-paid payout update failed:", error);
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({
        error: "Pending payout not found or already paid",
      });
    }

    console.log("✅ payout marked paid:", data.id);

    return res.json({
      ok: true,
      payout: data,
    });
  } catch (e) {
    console.error("💥 mark-paid payout route error:", e);
    return res.status(500).json({
      error: e.message || "Server error",
    });
  }
});

/**
 * =========================================
 * POST /api/payouts/release-ready
 * (manual trigger for auto payout job)
 * =========================================
 */
router.post("/release-ready", async (req, res) => {
  try {
    console.log("🚀 Manual payout release triggered");

    const result = await releasePayouts();

    return res.json(result);
  } catch (e) {
    console.error("💥 release-ready route error:", e);
    return res.status(500).json({
      error: e.message || "Server error",
    });
  }
});

module.exports = router;

