const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");

test("Uncleared driver cannot create a deposit checkout", async () => {
  const routePath = require.resolve("../routes/squareRoutes.cjs");
  const originalLoad = Module._load;
  const originalFetch = global.fetch;

  let server;
  let squareCalled = false;

  try {
    global.fetch = async () => {
      squareCalled = true;
      throw new Error("External payment requests are forbidden");
    };

    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return {
            supabaseAdmin: {
              from(table) {
                assert.equal(table, "bookings");
                return {
                  select() { return this; },
                  eq() { return this; },
                  async maybeSingle() {
                    return {
                      data: {
                        id: "test-booking",
                        driver_id: "test-driver",
                        host_approved: true,
                        status: "approved",
                        deposit_paid: false,
                        payment_status: "unpaid",
                        deposit_amount_cents: 25000,
                        total_price_cents: 10000
                      },
                      error: null
                    };
                  }
                };
              }
            }
          };
        }

        if (request === "../middlewares/auth.cjs") {
          return (req, res, next) => {
            req.user = { id: "test-driver" };
            next();
          };
        }

        if (request === "../utils/pushNotifications.cjs") {
          return { notifyUser: async () => {} };
        }

        if (request === "../services/driverBackgroundChecks.cjs") {
          return {
            SCREENING_FEE_CENTS: 3949,
            getDriverBackgroundCheck: async () => null,
            isRentalScreeningEligible: () => false,
            needsScreeningFee: () => true,
            reserveDriverScreeningFee: async () => {
              throw new Error("Screening reservation not expected");
            }
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
    app.use("/square", router);

    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));

    const response = await originalFetch(
      `http://127.0.0.1:${server.address().port}/square/create-payment-link`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: "test-booking",
          payment_type: "deposit"
        })
      }
    );

    assert.equal(response.status, 409);
    assert.equal(squareCalled, false);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});
