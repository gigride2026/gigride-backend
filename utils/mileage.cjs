// utils/mileage.cjs
function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function getMileageSnapshot({
  rentalType,
  vehicle,
  unlimitedSelected,
}) {
  const type = String(rentalType || "").toLowerCase();

  let includedMiles = 0;
  let unlimitedFeeCents = 0;
  let planLabel = "standard";

  if (type === "weekly") {
    includedMiles = toInt(vehicle?.weekly_miles_included, 1400);
    unlimitedFeeCents = toInt(vehicle?.weekly_unlimited_fee_cents, 0);
  } else if (type === "monthly") {
    includedMiles = toInt(vehicle?.monthly_miles_included, 6000);
    unlimitedFeeCents = toInt(vehicle?.monthly_unlimited_fee_cents, 0);
  } else {
    includedMiles = toInt(vehicle?.daily_miles_included, 200);
    unlimitedFeeCents = toInt(vehicle?.daily_unlimited_fee_cents, 0);
  }

  const allowsUnlimited = !!vehicle?.allows_unlimited_miles;
  const finalUnlimitedSelected = allowsUnlimited && !!unlimitedSelected;

  if (finalUnlimitedSelected) {
    planLabel = "unlimited";
  }

  return {
    included_miles: includedMiles,
    unlimited_miles_selected: finalUnlimitedSelected,
    unlimited_miles_fee_cents: finalUnlimitedSelected ? unlimitedFeeCents : 0,
    overage_rate_cents: toInt(vehicle?.overage_rate_cents, 30),
    mileage_plan_label: planLabel,
  };
}

function calculateMileageCharge(booking) {
  const start = toInt(booking?.start_odometer, 0);
  const end = toInt(booking?.end_odometer, 0);
  const totalMilesDriven = Math.max(end - start, 0);

  if (booking?.unlimited_miles_selected) {
    return {
      total_miles_driven: totalMilesDriven,
      mileage_overage_miles: 0,
      mileage_overage_cents: 0,
    };
  }

  const included = toInt(booking?.included_miles, 0);
  const rate = toInt(booking?.overage_rate_cents, 0);
  const overageMiles = Math.max(totalMilesDriven - included, 0);
  const overageCents = overageMiles * rate;

  return {
    total_miles_driven: totalMilesDriven,
    mileage_overage_miles: overageMiles,
    mileage_overage_cents: overageCents,
  };
}

module.exports = {
  getMileageSnapshot,
  calculateMileageCharge,
};