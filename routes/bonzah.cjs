const express = require("express");
const router = express.Router();

const { getBonzahToken } = require("../services/bonzahClient.cjs");

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

module.exports = router;