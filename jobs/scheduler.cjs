require("dotenv").config();
const cron = require("node-cron");

const { releaseDepositRefunds } = require("./releaseDepositRefunds.cjs");

let started = false;

function startSchedulers() {
  if (started) {
    console.log("⚠️ Schedulers already started");
    return;
  }

  started = true;

  console.log("🕒 Starting schedulers...");

  // Host payout scheduler temporarily disabled until real Square host payouts are connected.
  // Do not mark payouts paid unless funds have actually been transferred.

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