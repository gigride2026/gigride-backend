const express = require("express");

const router = express.Router();

router.post("/:payoutId/mark-paid", (req, res) => {
  return res.status(503).json({
    error: "Host payout marking is temporarily disabled until real payout transfers are connected.",
  });
});

router.post("/release-ready", (req, res) => {
  return res.status(503).json({
    error: "Host payout release is temporarily disabled until real payout transfers are connected.",
  });
});

module.exports = router;
