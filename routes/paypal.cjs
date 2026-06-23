const express = require("express");
const router = express.Router();

router.get("/test", (req, res) => {
  res.json({
    ok: true,
    message: "PayPal route connected",
    env: process.env.PAYPAL_ENV,
    hasClientId: !!process.env.PAYPAL_CLIENT_ID,
    hasSecret: !!process.env.PAYPAL_CLIENT_SECRET,
  });
});

module.exports = router;