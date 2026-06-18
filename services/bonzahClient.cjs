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

  cachedToken = response.data.data?.token || response.data.token;
  tokenExpires = Date.now() + 10 * 60 * 1000;

  return cachedToken;
}

function bonzahHeaders(token) {
  return {
    "Content-Type": "application/json",
    "in-auth-token": token,
    "auth-token": token,
    Authorization: `Bearer ${token}`,
  };
}

async function bonzahPremiumCalc(payload) {
  const token = await getBonzahToken();

  try {
    const response = await axios.post(
      `${process.env.BONZAH_API_URL}/api/v1/Bonzah/premiumCalc`,
      payload,
      {
        headers: bonzahHeaders(token),
      }
    );

    console.log(
      "🛡️ Bonzah premium raw:",
      JSON.stringify(response.data, null, 2)
    );

    return response.data;
  } catch (e) {
    console.error("❌ Bonzah premium axios error:", {
      message: e.message,
      status: e.response?.status,
      data: e.response?.data,
    });

    throw e;
  }
}

async function bonzahQuote(payload) {
  const token = await getBonzahToken();

  const response = await axios.post(
    `${process.env.BONZAH_API_URL}/api/v1/Bonzah/quote`,
    payload,
    {
      headers: bonzahHeaders(token),
    }
  );

  return response.data;
}

module.exports = {
  getBonzahToken,
  bonzahPremiumCalc,
  bonzahQuote,
};