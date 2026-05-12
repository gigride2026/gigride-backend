function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getTaxProfileForPickup({ city, county, state }) {
  const normalizedCity = normalize(city);
  const normalizedCounty = normalize(county);
  const normalizedState = normalize(state);

  // Atlanta launch profile
  if (
    normalizedState === "ga" ||
    normalizedState === "georgia"
  ) {
    if (
      normalizedCity === "atlanta" ||
      normalizedCounty === "fulton" ||
      normalizedCounty === "fulton county"
    ) {
      return {
        jurisdiction: "Atlanta, GA",
        salesTaxRate: 0.089,
        rentalTaxRate: 0.03,
      };
    }

    // Georgia fallback until you add more city/county profiles
    return {
      jurisdiction: "Georgia",
      salesTaxRate: 0.04,
      rentalTaxRate: 0.03,
    };
  }

  // Default fallback
  return {
    jurisdiction: "Default",
    salesTaxRate: 0,
    rentalTaxRate: 0,
  };
}

function calculateRentalTax({ subtotalCents, city, county, state }) {
  const profile = getTaxProfileForPickup({ city, county, state });

  const salesTaxCents = Math.round(subtotalCents * profile.salesTaxRate);
  const rentalTaxCents = Math.round(subtotalCents * profile.rentalTaxRate);
  const totalTaxCents = salesTaxCents + rentalTaxCents;

  return {
    ...profile,
    salesTaxCents,
    rentalTaxCents,
    totalTaxCents,
    totalCents: subtotalCents + totalTaxCents,
  };
}

module.exports = {
  getTaxProfileForPickup,
  calculateRentalTax,
};