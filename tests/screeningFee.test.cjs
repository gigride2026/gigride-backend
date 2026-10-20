const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SCREENING_FEE_CENTS,
  needsScreeningFee,
} = require("../services/driverBackgroundChecks.cjs");
test("GigRide background-check fee including MVR is exactly $39.49", () => {
  assert.equal(SCREENING_FEE_CENTS, 3949);
});

test("needsScreeningFee is available for screening eligibility checks", () => {
  assert.equal(typeof needsScreeningFee, "function");
});
test("New drivers require the screening fee", () => {
  assert.equal(needsScreeningFee(null), true);
});

test("Unpaid drivers require the screening fee", () => {
  assert.equal(
    needsScreeningFee({ fee_payment_status: "unpaid" }),
    true
  );
});

test("Pending screening payments do not require another fee", () => {
  assert.equal(
    needsScreeningFee({ fee_payment_status: "pending" }),
    false
  );
});

test("Paid drivers do not require another screening fee", () => {
  assert.equal(
    needsScreeningFee({ fee_payment_status: "paid" }),
    false
  );
});

test("Refunded screening fees do not trigger automatic repayment", () => {
  assert.equal(
    needsScreeningFee({ fee_payment_status: "refunded" }),
    false
  );
});
