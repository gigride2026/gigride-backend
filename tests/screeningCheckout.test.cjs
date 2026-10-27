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

test("Existing unpaid Square screening checkout is reused", async () => {
  const routePath = require.resolve("../routes/squareRoutes.cjs");
  const originalLoad = Module._load;
  const originalFlag = process.env.CHECKR_SCREENING_CHECKOUT_ENABLED;
  const originalFetch = global.fetch;
  let server;
  let squareCreateCalls = 0;
  let reservationCalls = 0;

  try {
    process.env.CHECKR_SCREENING_CHECKOUT_ENABLED = "true";

    global.fetch = async (url, options) => {
      const path = String(url);

      if (options?.method === "POST") {
        squareCreateCalls++;
        throw new Error("Duplicate Square checkout creation");
      }

      if (path.includes("/payment-links/link-test")) {
        return new Response(JSON.stringify({
          payment_link: {
            id: "link-test",
            order_id: "order-test",
          },
        }), { status: 200 });
      }

      if (path.includes("/v2/orders/order-test")) {
        return new Response(JSON.stringify({
          order: {
            id: "order-test",
            state: "OPEN",
            total_money: {
              amount: 3949,
              currency: "USD",
            },
            tenders: [],
          },
        }), { status: 200 });
      }

      throw new Error("Unexpected Square request: " + path);
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
              fee_payment_status: "pending",
              fee_payment_link_id: "link-test",
              fee_checkout_url: "https://sandbox.web.squarecdn.com/test",
            }),
            reserveDriverScreeningFee: async () => {
              reservationCalls++;
              throw new Error("Existing checkout must be reused");
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

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.payment_link_id, "link-test");
    assert.equal(squareCreateCalls, 0);
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

test("Concurrent checkout save returns 409 without exposing an unverified link", async () => {
  const routePath = require.resolve("../routes/squareRoutes.cjs");
  const originalLoad = Module._load;
  const originalFlag = process.env.CHECKR_SCREENING_CHECKOUT_ENABLED;
  const originalFetch = global.fetch;
  const originalToken = process.env.SQUARE_ACCESS_TOKEN;
  const originalLocation = process.env.SQUARE_LOCATION_ID;
  let server;
  let squareCreateCalls = 0;
  let screeningReads = 0;

  try {
    process.env.CHECKR_SCREENING_CHECKOUT_ENABLED = "true";
    process.env.SQUARE_ACCESS_TOKEN = "mock-square-token";
    process.env.SQUARE_LOCATION_ID = "mock-location";

    global.fetch = async (url, options) => {
      assert.match(String(url), /\/v2\/online-checkout\/payment-links$/);
      assert.equal(options?.method, "POST");
      squareCreateCalls++;

      const request = JSON.parse(options.body);
      assert.equal(request.order.line_items[0].base_price_money.amount, 3949);

      return new Response(JSON.stringify({
        payment_link: {
          id: "link-created",
          url: "https://example.invalid/created-checkout",
        },
      }), { status: 200 });
    };

    const mockSupabase = {
      from(table) {
        if (table === "bookings") {
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
        }

        if (table === "driver_background_checks") {
          const query = {
            select() { return this; },
            eq() { return this; },
            is() { return this; },
            update() { return this; },
            async single() {
              return {
                data: { first_booking_id: "test-booking" },
                error: null,
              };
            },
            async maybeSingle() {
              // Another request saved the checkout first.
              return { data: null, error: null };
            },
          };
          return query;
        }

        throw new Error("Unexpected table: " + table);
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
            getDriverBackgroundCheck: async () => {
              screeningReads++;
              return screeningReads === 1
                ? null
                : {
                    fee_payment_status: "pending",
                    fee_payment_link_id: "link-other-request",
                    fee_checkout_url: "https://example.invalid/unverified-checkout",
                  };
            },
            reserveDriverScreeningFee: async () => ({
              reservation_id: "test-reservation",
              fee_cents: 3949,
            }),
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
    const body = await response.json();
    assert.equal(body.checkout_url, undefined);
    assert.equal(body.payment_link_id, undefined);
    assert.equal(squareCreateCalls, 1);
    assert.equal(screeningReads, 2);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    delete require.cache[routePath];

    for (const [name, value] of [
      ["CHECKR_SCREENING_CHECKOUT_ENABLED", originalFlag],
      ["SQUARE_ACCESS_TOKEN", originalToken],
      ["SQUARE_LOCATION_ID", originalLocation],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});
