const express = require("express");
const router = express.Router();

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
      `${process.env.BONZAH_API_URL}/api/v1/bonzah/master`,
      {
        headers: {
          "in-auth-token": token,
          "Content-Type": "application/json",
        },
        params: {
          master_name: "country",
          values: "country",
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

module.exports = router;