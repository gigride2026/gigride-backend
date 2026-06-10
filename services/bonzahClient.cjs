async function bonzahPremiumCalc(payload) {
  const token = await getBonzahToken();

  const response = await axios.post(
    `${process.env.BONZAH_API_URL}/api/v1/bonzah/premiumCalc`,
    {
      ...payload,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
    }
  );

  return response.data;
}

async function bonzahQuote(payload) {
  const token = await getBonzahToken();

  const response = await axios.post(
    `${process.env.BONZAH_API_URL}/api/v1/bonzah/quote`,
    {
      ...payload,
      token,
    },
    {
      headers: {
        "Content-Type": "application/json",
        token,
      },
    }
  );

  return response.data;
}
module.exports = {
  getBonzahToken,
  bonzahPremiumCalc,
  bonzahQuote,
};