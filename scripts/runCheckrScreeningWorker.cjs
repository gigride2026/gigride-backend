
const {
  processPaidScreenings,
} = require("../services/processPaidScreenings.cjs");

async function main() {
  try {
    const result = await processPaidScreenings();

    console.log("CHECKR SCREENING WORKER RESULT:", result);

    if (!result.enabled) {
      console.log("Checkr screening worker is disabled.");
    }
  } catch (error) {
    console.error("CHECKR SCREENING WORKER FAILED:", error.message);
    process.exitCode = 1;
  }
}

main();
