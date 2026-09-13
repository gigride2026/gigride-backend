async function releasePayouts() {
  throw new Error(
    "Host payouts are disabled until real Square payout transfers are connected."
  );
}

module.exports = { releasePayouts };
