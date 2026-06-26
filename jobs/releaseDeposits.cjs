// Stripe deposit scheduler removed.
// Square does not support automatic refunds yet.

module.exports = async function releaseDeposits() {
  console.log("Deposit scheduler disabled (Square version).");
};