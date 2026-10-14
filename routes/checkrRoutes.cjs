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

module.exports = router;
