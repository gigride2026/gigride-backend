require("dotenv").config();
const cron = require("node-cron");

const { releaseDepositRefunds } = require("./releaseDepositRefunds.cjs");
const { runHostBookingReminders } = require("./hostBookingReminders.cjs");

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

  // Check every 5 minutes for booking requests awaiting a host decision.
  cron.schedule("*/5 * * * *", async () => {
    try {
      console.log("⏰ Running host booking reminder job...");
      const result = await runHostBookingReminders();
      console.log("✅ Host booking reminder result:", result);
    } catch (err) {
      console.error("❌ Host booking reminder job failed:", err);
    }
  });

  console.log("✅ Schedulers started");
}

module.exports = { startSchedulers };