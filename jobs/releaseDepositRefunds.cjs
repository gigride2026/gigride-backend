// Stripe refund scheduler removed.
// Square refunds are handled manually by hosts for now.

module.exports = async function releaseDepositRefunds() {
  console.log("Deposit refund scheduler disabled (Square version).");
};