const express = require("express");
const router = express.Router();

const { releaseDepositRefunds } = require("../jobs/releaseDepositRefunds.cjs");

router.post("/release-ready", async (req, res) => {
  try {
    console.log("🚀 Manual deposit refund release triggered");

    const result = await releaseDepositRefunds();

    return res.json(result);
  } catch (e) {
    console.error("💥 deposit refund release route error:", e);
    return res.status(500).json({
      error: e.message || "Server error",
    });
  }
});

module.exports = router;