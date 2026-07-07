const express = require("express");

const router = express.Router();

router.post("/delete-account", (req, res) => {
  console.log("DELETE ROUTE HIT");
  return res.json({
    ok: true,
    message: "Route works",
  });
});

module.exports = router;