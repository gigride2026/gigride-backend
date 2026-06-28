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

  // Every Tuesday and Friday at 9:00 AM
cron.schedule("0 9 * * 2,5", async () => {
    try {
      console.log("🚀 Running scheduled payout release job...");
      const result = await releasePayouts();
      console.log("✅ Scheduled payout release result:", result);
    } catch (err) {
      console.error("❌ Scheduled payout release failed:", err);
    }
  });

  // Every day at 9:30 AM
cron.schedule("30 9 * * *", async () => {
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