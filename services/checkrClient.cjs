
const axios = require("axios");

const CHECKR_BASE_URL = "https://api.checkr-staging.com/v1";

function getCheckrClient() {
  const apiKey = process.env.CHECKR_API_KEY;

  if (!apiKey) {
    throw new Error("CHECKR_API_KEY is not configured");
  }

  return axios.create({
    baseURL: CHECKR_BASE_URL,
    auth: {
      username: apiKey,
      password: "",
    },
    headers: {
      Accept: "application/json",
    },
    timeout: 20000,
  });
}

async function getCheckrAccount() {
  const response = await getCheckrClient().get("/account");
  return response.data;
}

async function createCheckrInvitation({ candidateId, packageSlug }) {
  if (!candidateId || !packageSlug) {
    throw new Error("candidateId and packageSlug are required");
  }

  const params = new URLSearchParams();
  params.set("candidate_id", candidateId);
  params.set("package", packageSlug);

  const response = await getCheckrClient().post(
    "/invitations",
    params.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return response.data;
}

async function getCheckrReport(reportId) {
  if (!reportId) {
    throw new Error("reportId is required");
  }

  const response = await getCheckrClient().get(
    `/reports/${encodeURIComponent(reportId)}`
  );

  return response.data;
}

module.exports = {
  getCheckrAccount,
  createCheckrInvitation,
  getCheckrReport,
};
