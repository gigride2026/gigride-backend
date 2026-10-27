
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const SERVICE_PATH = require.resolve(
  "../services/startDriverScreening.cjs"
);

function createMocks({
  paymentStatus = "paid",
  screeningStatus = "not_started",
  claimSucceeds = true,
  candidateFails = false,
  invitationFails = false,
vehicleCity = "Savannah",
  vehicleState = "GA",
} = {}) {
  const calls = {
    claims: 0,
    candidates: 0,
    invitations: 0,
    savedCandidates: 0,
    savedInvitations: 0,
  };
const screening = {
  status: screeningStatus,
  fee_payment_status: paymentStatus,
  first_booking_id: "booking-test-id",
    checkr_candidate_id: null,
    checkr_invitation_id: null,
    checkr_report_id: null,
    screening_started_at: null,
  };

  const supabaseAdmin = {
    auth: {
      admin: {
        async getUserById() {
          return {
            data: { user: { email: "driver@example.com" } },
            error: null,
          };
        },
      },
    },

    from(table) {

if (table === "bookings") {
  return {
    select() {
      return {
        eq() {
          return this;
        },
        async single() {
          return {
            data: { vehicle_id: "vehicle-test-id" },
            error: null,
          };
        },
      };
    },
  };
}

if (table === "vehicles") {
  return {
    select() {
      return {
        eq() {
          return this;
        },
        async single() {
          return {

data: {
  city: vehicleCity,
  state: vehicleState,
},
            error: null,
          };
        },
      };
    },
  };
}
 if (table === "profiles") {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return {
                      data: { full_name: "Test Driver" },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      assert.equal(table, "driver_background_checks");

      return {
        update(values) {
          const isCandidate = Boolean(values.checkr_candidate_id);

          return {
            eq() {
              return this;
            },
            is() {
              return this;
            },
            select() {
              return {
                async single() {
                  if (isCandidate) {
                    calls.savedCandidates++;
                  } else {
                    calls.savedInvitations++;
                  }

                  return {
                    data: { id: "screening-test-id" },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },

    async rpc(name) {
      assert.equal(name, "claim_driver_screening");
      calls.claims++;

      return {
        data: claimSucceeds,
        error: null,
      };
    },
  };

  const checkrClient = {
    async createCheckrCandidate() {
      calls.candidates++;

      if (candidateFails) {
        throw new Error("Candidate creation failed");
      }

      return { id: "candidate-test-id" };
    },

async createCheckrInvitation({ candidateId, city, state }) {
  assert.equal(candidateId, "candidate-test-id");
  assert.equal(city, vehicleCity.trim());
  assert.equal(state, vehicleState.trim().toUpperCase());

  calls.invitations++;

      if (invitationFails) {
        throw new Error("Invitation creation failed");
      }

      return { id: "invitation-test-id" };
    },
  };

  return { calls, screening, supabaseAdmin, checkrClient };
}

async function withMockedService(options, callback) {
  const originalLoad = Module._load;
  const originalEnabled =
    process.env.CHECKR_SCREENING_INITIATION_ENABLED;

  const mocks = createMocks(options);

  process.env.CHECKR_SCREENING_INITIATION_ENABLED = "true";

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === SERVICE_PATH) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return { supabaseAdmin: mocks.supabaseAdmin };
        }

        if (request === "./checkrClient.cjs") {
          return mocks.checkrClient;
        }

        if (request === "./driverBackgroundChecks.cjs") {
          return {
            async getDriverBackgroundCheck() {
              return mocks.screening;
            },
          };
        }
      }

      return originalLoad.apply(this, arguments);
    };

    delete require.cache[SERVICE_PATH];

    const { startDriverScreening } = require(SERVICE_PATH);

    await callback(startDriverScreening, mocks.calls);
  } finally {
    Module._load = originalLoad;
    delete require.cache[SERVICE_PATH];

    if (originalEnabled === undefined) {
      delete process.env.CHECKR_SCREENING_INITIATION_ENABLED;
    } else {
      process.env.CHECKR_SCREENING_INITIATION_ENABLED =
        originalEnabled;
    }
  }
}

test("unpaid screening cannot start", async () => {
  await withMockedService(
    { paymentStatus: "unpaid" },
    async (start, calls) => {
      await assert.rejects(
        start("driver-test-id"),
        /Screening fee has not been paid/
      );

      assert.equal(calls.claims, 0);
      assert.equal(calls.candidates, 0);
      assert.equal(calls.invitations, 0);
    }
  );
});

test("existing screening cannot start again", async () => {
  await withMockedService(
    { screeningStatus: "initiating" },
    async (start, calls) => {
      await assert.rejects(
        start("driver-test-id"),
        /Screening already started/
      );

      assert.equal(calls.claims, 0);
      assert.equal(calls.candidates, 0);
    }
  );
});

test("failed database claim creates no Checkr candidate", async () => {
  await withMockedService(
    { claimSucceeds: false },
    async (start, calls) => {
      await assert.rejects(
        start("driver-test-id"),
        /Screening could not be claimed/
      );

      assert.equal(calls.claims, 1);
      assert.equal(calls.candidates, 0);
      assert.equal(calls.invitations, 0);
    }
  );
});

test("successful screening creates one candidate and invitation", async () => {
  await withMockedService({}, async (start, calls) => {
    const result = await start("driver-test-id");

    assert.equal(result.success, true);
    assert.equal(result.status, "invitation_created");
    assert.equal(calls.claims, 1);
    assert.equal(calls.candidates, 1);
    assert.equal(calls.savedCandidates, 1);
    assert.equal(calls.invitations, 1);
    assert.equal(calls.savedInvitations, 1);
  });
});

test("candidate failure does not create invitation", async () => {
  await withMockedService(
    { candidateFails: true },
    async (start, calls) => {
      await assert.rejects(
        start("driver-test-id"),
        /Candidate creation failed/
      );

      assert.equal(calls.claims, 1);
      assert.equal(calls.candidates, 1);
      assert.equal(calls.invitations, 0);
    }
  );
});

test("invitation failure is reported without automatic retry", async () => {
  await withMockedService(
    { invitationFails: true },
    async (start, calls) => {
      await assert.rejects(
        start("driver-test-id"),
        /Invitation creation failed/
      );

assert.equal(calls.claims, 1);
assert.equal(calls.candidates, 1);
assert.equal(calls.savedCandidates, 1);
assert.equal(calls.invitations, 1);
  }
);
});
test("Florida booking sends Jacksonville location to Checkr", async () => {
  await withMockedService(
    {
      vehicleCity: "Jacksonville",
      vehicleState: "FL",
    },
    async (start, calls) => {
      const result = await start("driver-test-id");

      assert.equal(result.success, true);
      assert.equal(result.status, "invitation_created");

      assert.equal(calls.invitations, 1);
    }
  );
});

test("missing vehicle state blocks Checkr screening", async () => {
  await withMockedService(
    {
      vehicleCity: "Savannah",
      vehicleState: "",
    },
    async (start, calls) => {
      await assert.rejects(
        start("driver-test-id"),
        /Valid vehicle city and two-letter state code are required/
      );

      assert.equal(calls.claims, 0);
      assert.equal(calls.candidates, 0);
      assert.equal(calls.invitations, 0);
    }
  );
});
