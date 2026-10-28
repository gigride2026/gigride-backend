
const axios = require("axios");
const CHECKR_PACKAGE_SLUG = process.env.CHECKR_PACKAGE_SLUG;

const CHECKR_BASE_URL = "https://" + "api.checkr-staging.com/v1";
function getCheckrClient() {
  const apiKey = process.env.CHECKR_API_KEY;

const checkrEnvironment = process.env.CHECKR_ENVIRONMENT || "staging";

if (checkrEnvironment !== "staging") {
  throw new Error(
    "Checkr production access is disabled. Only staging is permitted."
  );
}

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
async function createCheckrCandidate({ firstName, lastName, email }) {
  if (!firstName || !lastName || !email) {
    throw new Error("First name, last name, and email are required");
  }

  const params = new URLSearchParams();
  params.set("first_name", firstName);
  params.set("last_name", lastName);
  params.set("email", email);

  const response = await getCheckrClient().post(
    "/candidates",
    params.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return response.data;
}

async function createCheckrInvitation({
  candidateId,
  packageSlug = CHECKR_PACKAGE_SLUG,
  city,
  state,
}) {
  if (!candidateId || !packageSlug) {
    throw new Error("candidateId and packageSlug are required");
  }

if (
  typeof city !== "string" ||
  !city.trim() ||
  typeof state !== "string" ||
  !/^[A-Za-z]{2}$/.test(state.trim())
) {
  throw new Error(
    "A valid vehicle city and two-letter state code are required for Checkr"
  );
}

city = city.trim();
state = state.trim().toUpperCase();

  const params = new URLSearchParams();
  params.set("candidate_id", candidateId);
  params.set("package", packageSlug);
params.set("work_locations[][country]", "US");
params.set("work_locations[][state]", state);
params.set("work_locations[][city]", city);
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

async function getCheckrInvitation(invitationId) {
  if (typeof invitationId !== "string" || !invitationId.trim()) {
    throw new Error("invitationId is required");
  }

  const response = await getCheckrClient().get(
    `/invitations/${encodeURIComponent(invitationId.trim())}`
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
createCheckrCandidate,
  createCheckrInvitation,
  getCheckrInvitation,
  getCheckrReport,
};
