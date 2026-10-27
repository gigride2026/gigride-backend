const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");

test("Screening checkout stays disabled when the feature flag is off", async () => {
  const routePath = require.resolve("../routes/squareRoutes.cjs");
  const originalLoad = Module._load;
  const originalFlag = process.env.CHECKR_SCREENING_CHECKOUT_ENABLED;
  const originalFetch = global.fetch;
  let server;
  let squareCalled = false;

  try {
    process.env.CHECKR_SCREENING_CHECKOUT_ENABLED = "false";

    global.fetch = async () => {
      squareCalled = true;
      throw new Error("External requests are forbidden in this test");
    };

    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return {
            supabaseAdmin: {
              from() {
                throw new Error("Database access is forbidden");
              },
            },
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
            reserveDriverScreeningFee: async () => {
              throw new Error("Reservation must not occur");
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
    app.use("/square", router);

    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));

    const response = await originalFetch(
      `http://127.0.0.1:${server.address().port}/square/create-background-check-payment-link`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: "test-booking" }),
      }
    );

    assert.equal(response.status, 503);
    assert.equal(squareCalled, false);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    delete require.cache[routePath];

    if (originalFlag === undefined) {
      delete process.env.CHECKR_SCREENING_CHECKOUT_ENABLED;
    } else {
      process.env.CHECKR_SCREENING_CHECKOUT_ENABLED = originalFlag;
    }

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("Already-paid driver cannot create another screening checkout", async () => {
  const routePath = require.resolve("../routes/squareRoutes.cjs");
  const originalLoad = Module._load;
  const originalFlag = process.env.CHECKR_SCREENING_CHECKOUT_ENABLED;
  const originalFetch = global.fetch;
  let server;
  let externalCalls = 0;
  let reservationCalls = 0;

  try {
    // Enable only within this isolated test process.
    process.env.CHECKR_SCREENING_CHECKOUT_ENABLED = "true";

    global.fetch = async () => {
      externalCalls++;
      throw new Error("External requests are forbidden");
    };

    const mockSupabase = {
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
                status: "pending",
              },
              error: null,
            };
          },
        };
      },
    };

    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return { supabaseAdmin: mockSupabase };
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
            getDriverBackgroundCheck: async () => ({
              driver_id: "test-driver",
              fee_payment_status: "paid",
              square_payment_id: "existing-payment",
            }),
            reserveDriverScreeningFee: async () => {
              reservationCalls++;
              throw new Error("Already-paid driver must not reserve again");
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
    app.use("/square", router);

    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));

    const response = await originalFetch(
      `http://127.0.0.1:${server.address().port}/square/create-background-check-payment-link`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: "test-booking" }),
      }
    );

    assert.equal(response.status, 409);
    assert.equal(externalCalls, 0);
    assert.equal(reservationCalls, 0);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    delete require.cache[routePath];

    if (originalFlag === undefined) {
      delete process.env.CHECKR_SCREENING_CHECKOUT_ENABLED;
    } else {
      process.env.CHECKR_SCREENING_CHECKOUT_ENABLED = originalFlag;
    }

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});
