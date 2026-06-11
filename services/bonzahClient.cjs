const axios = require("axios");

let cachedToken = null;
let tokenExpires = 0;

async function getBonzahToken() {
  if (cachedToken && Date.now() < tokenExpires) {
    return cachedToken;
  }

  const response = await axios.post(
    `${process.env.BONZAH_API_URL}/api/v1/auth`,
    {
      email: process.env.BONZAH_EMAIL,
      pwd: process.env.BONZAH_PASSWORD,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (response.data.status !== 0) {
    throw new Error(response.data.txt || "Bonzah authentication failed");
  }

  cachedToken = response.data.token;
  tokenExpires = Date.now() + 14 * 60 * 1000;

  return cachedToken;
}

async function bonzahPremiumCalc(payload) {
  const token = await getBonzahToken();

  const response = await axios.post(
    `${process.env.BONZAH_API_URL}/api/v1/Bonzah/premiumCalc`,
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
    `${process.env.BONZAH_API_URL}/api/v1/Bonzah/quote`,
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