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
    }
  );

  if (response.data.status !== 0) {
    throw new Error("Bonzah authentication failed");
  }

  cachedToken = response.data.token;

  tokenExpires = Date.now() + 14 * 60 * 1000;

  return cachedToken;
}

module.exports = {
  getBonzahToken,
};