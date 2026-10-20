
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const {
  createCheckrCandidate,
  createCheckrInvitation,
} = require("./checkrClient.cjs");
const {
  getDriverBackgroundCheck,
} = require("./driverBackgroundChecks.cjs");

async function startDriverScreening(driverId) {
  if (!driverId) {
    throw new Error("Driver ID is required");
  }

  // Safety guard: do not initiate screenings until integration is enabled.
  if (process.env.CHECKR_SCREENING_INITIATION_ENABLED !== "true") {
    throw new Error("Checkr screening initiation is disabled");
  }

  const screening = await getDriverBackgroundCheck(
    supabaseAdmin,
    driverId
  );

  if (!screening || screening.fee_payment_status !== "paid") {
    throw new Error("Screening fee has not been paid");
  }

  if (
    screening.status === "initiating" ||
    screening.checkr_candidate_id ||
    screening.checkr_invitation_id ||
    screening.checkr_report_id ||
    screening.screening_started_at
  ) {
    throw new Error("Screening already started or requires review");
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", driverId)
    .single();

  if (profileError || !profile?.full_name?.trim()) {
    throw new Error("Driver full name is required");
  }

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.getUserById(driverId);

  if (authError || !authData?.user?.email) {
    throw new Error("Driver email is required");
  }

  const nameParts = profile.full_name.trim().split(/\s+/);
  const firstName = nameParts.shift();
  const lastName = nameParts.join(" ");

  if (!firstName || !lastName) {
    throw new Error("Driver first and last name are required");
  }

  // Atomically claim the screening to prevent duplicate initiation.
  const { data: claimed, error: claimError } =
    await supabaseAdmin.rpc("claim_driver_screening", {
      p_driver_id: driverId,
    });

  if (claimError) throw claimError;

  if (claimed !== true) {
    throw new Error("Screening could not be claimed");
  }

  // Once claimed, failures require manual reconciliation.
  // Do not automatically retry Checkr API calls.
  const candidate = await createCheckrCandidate({
    firstName,
    lastName,
    email: authData.user.email,
  });

  if (!candidate?.id) {
    throw new Error("Checkr candidate creation failed");
  }

  const { data: savedCandidate, error: candidateError } =
    await supabaseAdmin
      .from("driver_background_checks")
      .update({
        checkr_candidate_id: candidate.id,
        updated_at: new Date().toISOString(),
      })
      .eq("driver_id", driverId)
      .eq("status", "initiating")
      .is("checkr_candidate_id", null)
      .select("id")
      .single();

  if (candidateError || !savedCandidate) {
    throw new Error("Candidate created but could not be saved");
  }

  const invitation = await createCheckrInvitation({
    candidateId: candidate.id,
  });

  if (!invitation?.id) {
    throw new Error("Checkr invitation creation failed");
  }

  const { data: savedInvitation, error: invitationError } =
    await supabaseAdmin
      .from("driver_background_checks")
      .update({
        checkr_invitation_id: invitation.id,
        updated_at: new Date().toISOString(),
      })
      .eq("driver_id", driverId)
      .eq("status", "initiating")
      .eq("checkr_candidate_id", candidate.id)
      .is("checkr_invitation_id", null)
      .select("id")
      .single();

  if (invitationError || !savedInvitation) {
    throw new Error("Invitation created but could not be saved");
  }

  return {
    success: true,
    status: "invitation_created",
  };
}

module.exports = { startDriverScreening };
