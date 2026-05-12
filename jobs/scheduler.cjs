require("dotenv").config();
const cron = require("node-cron");

const { releasePayouts } = require("./releasePayouts.cjs");
const { releaseDepositRefunds } = require("./releaseDepositRefunds.cjs");

let started = false;

function startSchedulers() {
  if (started) {
    console.log("⚠️ Schedulers already started");
    return;
  }

  started = true;

  console.log("🕒 Starting schedulers...");

  // Every hour at minute 0
  cron.schedule("*/2 * * * *", async () => {
    try {
      console.log("🚀 Running scheduled payout release job...");
      const result = await releasePayouts();
      console.log("✅ Scheduled payout release result:", result);
    } catch (err) {
      console.error("❌ Scheduled payout release failed:", err);
    }
  });

  // Every hour at minute 5
  cron.schedule("*/3 * * * *", async () => {
    try {
      console.log("💸 Running scheduled deposit refund job...");
      const result = await releaseDepositRefunds();
      console.log("✅ Scheduled deposit refund result:", result);
    } catch (err) {
      console.error("❌ Scheduled deposit refund failed:", err);
    }
  });

  console.log("✅ Schedulers started");
}

module.exports = { startSchedulers };