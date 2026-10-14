const express = require("express");
const authMiddleware = require("../middlewares/auth.cjs");
const { getCheckrAccount } = require("../services/checkrClient.cjs");

const router = express.Router();

// All Checkr endpoints require authentication.
router.use(authMiddleware);

// Safe connection test: does not initiate a background check.
router.get("/status", async (req, res) => {
  try {
    return res.json({
      configured: Boolean(process.env.CHECKR_API_KEY),
      message: "Checkr route is working",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to check Checkr configuration",
    });
  }
});

// Authenticated Checkr API connection test (read-only)
router.get("/test-connection", async (req, res) => {
  try {
    const account = await getCheckrAccount();

    return res.json({
      connected: true,
      message: "Checkr API connection successful",
      accountId: account.id,
    });
  } catch (error) {
    console.error("Checkr connection test failed:", error.message);

    return res.status(502).json({
      connected: false,
      message: "Checkr API connection failed",
    });
  }
});

module.exports = router;
