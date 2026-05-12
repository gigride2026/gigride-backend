require("dotenv").config();

const { releasePayouts } = require("../jobs/releasePayouts.cjs");

(async () => {
  const result = await releasePayouts();
  console.log("📦 releasePayouts result:", result);
  process.exit(result?.ok ? 0 : 1);
})();