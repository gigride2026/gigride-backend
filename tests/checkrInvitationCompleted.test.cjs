const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");

test("completed Checkr invitation URL is hidden from the driver", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");
  let server;

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return { supabaseAdmin: {} };
        }
        if (request === "../middlewares/auth.cjs") {
          return (req, res, next) => {
            req.user = { id: "acknowledged-driver-id" };
            next();
          };
        }
        if (request === "../services/checkrClient.cjs") return {};
        if (request === "../services/driverBackgroundChecks.cjs") {
          return {
            async getDriverBackgroundCheck(db, driverId) {
              assert.equal(driverId, "acknowledged-driver-id");

return {
  screening_acknowledged_at: "2026-10-26T12:00:00Z",
  authorization_confirmed_at: null,
  fee_payment_status: "paid",
  status: "initiating",
  checkr_invitation_url: "https://apply.checkr.com/invite/test-driver",
  checkr_invitation_status: "completed",
  checkr_invitation_expires_at: "2026-11-04T12:00:00Z",
};
            },
            isRentalScreeningEligible(screening) {
              assert.equal(screening.authorization_confirmed_at, null);
              return false;
            },
          };
        }
      }
      return originalLoad.apply(this, arguments);
    };

    delete require.cache[routePath];
    const router = require(routePath);
    Module._load = originalLoad;

    const app = express();
    app.use(express.json());
    app.use("/api/checkr", router);

    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));

const response = await fetch(
  `http://127.0.0.1:${server.address().port}/api/checkr/my-screening?driver_id=another-driver-id`
);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      screening_required: true,
      fee_paid: true,
      fee_pending: false,

screening_status: "initiating",
checkr_invitation_url: null,
checkr_invitation_status: "completed",
checkr_invitation_expires_at: "2026-11-04T12:00:00Z",
rental_eligible: false,
      screening_acknowledged: true,
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

