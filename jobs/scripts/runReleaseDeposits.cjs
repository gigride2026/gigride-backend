process.stdout.write("🔥 TOP OF FILE EXECUTED 🔥\n");

console.log("🚀 RUNNER SCRIPT STARTED");

require("dotenv").config();
const releaseDeposits = require("../jobs/releaseDeposits.cjs");

console.log("📦 releaseDeposits export:", releaseDeposits);

if (typeof releaseDeposits !== "function") {
  console.error("❌ releaseDeposits is NOT a function");
  process.exit(1);
}

releaseDeposits()
  .then(() => {
    console.log("✅ Deposit release job finished");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Job failed:", err);
    process.exit(1);
  });




