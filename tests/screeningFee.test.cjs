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

const {
  isRentalScreeningEligible,
} = require("../services/driverBackgroundChecks.cjs");

test("A simulated report without a Checkr report ID cannot unlock rental payment", () => {
  const screening = {
    fee_payment_status: "paid",
    status: "review_required",
    checkr_report_status: "complete",
    checkr_report_result: "consider",
    checkr_report_id: null,
    report_conflict_hold: false,
    review_decision: "approved",
    reviewed_by: "owner-test-id",
    reviewed_at: "2026-10-25T16:32:51Z",
  };

  assert.equal(isRentalScreeningEligible(screening), false);
});

test("An approved consider report with a Checkr report ID can be rental eligible", () => {
  const screening = {
    fee_payment_status: "paid",
    status: "review_required",
    checkr_report_status: "complete",
    checkr_report_result: "consider",
    checkr_report_id: "report-test-id",
    report_conflict_hold: false,
    review_decision: "approved",
    reviewed_by: "owner-test-id",
    reviewed_at: "2026-10-25T16:32:51Z",
  };

  assert.equal(isRentalScreeningEligible(screening), true);
});
