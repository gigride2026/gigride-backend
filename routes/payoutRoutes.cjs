const express = require("express");

const router = express.Router();

router.post("/run-host-payout-batch", (req, res) => {
  return res.status(503).json({
    error: "Host payout batching is temporarily disabled until real payout transfers are connected.",
  });
});

module.exports = router;
