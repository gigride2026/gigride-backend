const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");

test("non-owner cannot access Checkr review queue", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");

  let databaseAccessed = false;
  let server;

  const mockSupabase = {
    from() {
      databaseAccessed = true;
      throw new Error("Unauthorized database access");
    },
    rpc() {
      databaseAccessed = true;
      throw new Error("Unauthorized RPC access");
    },
  };

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return { supabaseAdmin: mockSupabase };
        }

        if (request === "../middlewares/auth.cjs") {
          return (req, res, next) => {
            req.user = { id: "test-driver-id" };
            next();
          };
        }

        if (request === "../middlewares/staffAuth.cjs") {
          return {
            requireOwner: (req, res) => {
              res.status(403).json({
                error: "Owner access required",
              });
            },
          };
        }

        if (request === "../services/checkrClient.cjs") {
          return {};
        }

        if (request === "../services/driverBackgroundChecks.cjs") {
          return {};
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
    await new Promise((resolve) => server.once("listening", resolve));

    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/checkr/admin/review-queue`
    );

    assert.equal(response.status, 403);

const decisionResponse = await fetch(
  `http://127.0.0.1:${server.address().port}/api/checkr/admin/review-screening`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      screening_id: "11111111-1111-4111-8111-111111111111",
      decision: "approved",
      notes: "Security test only",
    }),
  }
);

assert.equal(decisionResponse.status, 403);

const reportResponse = await fetch(
  `http://127.0.0.1:${server.address().port}/api/checkr/admin/screening-report/11111111-1111-4111-8111-111111111111`
);

assert.equal(reportResponse.status, 403);
assert.equal(databaseAccessed, false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
test("owner receives only eligible Checkr screenings", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");
  let server;

  const eligible = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "review_required",
    review_decision: null,
    fee_payment_status: "paid",
    checkr_report_status: "complete",
    checkr_report_result: "consider",
    report_conflict_hold: false,
    checkr_report_id: "report-123",
  };

  const ineligible = {
    ...eligible,
    id: "22222222-2222-4222-8222-222222222222",
    fee_payment_status: "pending",
  };

  const query = {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    order() { return this; },
    limit() {
      return Promise.resolve({
        data: [eligible, ineligible],
        error: null,
      });
    },
  };

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return {
            supabaseAdmin: {
              from(table) {
                assert.equal(table, "driver_background_checks");
                return query;
              },
            },
          };
        }
        if (request === "../middlewares/auth.cjs") {
          return (req, res, next) => {
            req.user = { id: "test-owner-id" };
            next();
          };
        }
        if (request === "../middlewares/staffAuth.cjs") {
          return { requireOwner: (req, res, next) => next() };
        }
        if (request === "../services/checkrClient.cjs") return {};
        if (request === "../services/driverBackgroundChecks.cjs") return {};
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
      `http://127.0.0.1:${server.address().port}/api/checkr/admin/review-queue`
    );

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.screenings.length, 1);
    assert.equal(body.screenings[0].id, eligible.id);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});
test("owner approval uses authenticated owner ID", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");

  const screeningId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "22222222-2222-4222-8222-222222222222";

  let rpcCalled = false;
  let server;

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return {
            supabaseAdmin: {
              async rpc(functionName, params) {
                rpcCalled = true;

                assert.equal(functionName, "review_driver_screening");
                assert.equal(params.p_screening_id, screeningId);
                assert.equal(params.p_reviewer_id, ownerId);
                assert.equal(params.p_decision, "approved");
                assert.equal(params.p_notes, "Report reviewed");

                return {
                  data: { id: screeningId, review_decision: "approved" },
                  error: null,
                };
              },
            },
          };
        }

        if (request === "../middlewares/auth.cjs") {
          return (req, res, next) => {
            req.user = { id: ownerId };
            next();
          };
        }

        if (request === "../middlewares/staffAuth.cjs") {
          return { requireOwner: (req, res, next) => next() };
        }

        if (request === "../services/checkrClient.cjs") return {};
        if (request === "../services/driverBackgroundChecks.cjs") return {};
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
      `http://127.0.0.1:${server.address().port}/api/checkr/admin/review-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screening_id: screeningId,
          decision: "approved",
          notes: "  Report reviewed  ",
          reviewer_id: "fake-owner-id",
        }),
      }
    );

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(rpcCalled, true);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});
test("owner retrieves only allowed Checkr report fields", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");
  const screeningId = "11111111-1111-4111-8111-111111111111";
  const reportId = "mock-report-123";
  let server;
  let reportRequested = false;

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return {
            supabaseAdmin: {
              from(table) {
                assert.equal(table, "driver_background_checks");
                return {
                  select() { return this; },
                  eq(column, value) {
                    assert.equal(column, "id");
                    assert.equal(value, screeningId);
                    return this;
                  },
                  async single() {
                    return {
                      data: {
                        id: screeningId,
                        checkr_report_id: reportId,
                        status: "review_required",
                        review_decision: null,
                      },
                      error: null,
                    };
                  },
                };
              },
            },
          };
        }

        if (request === "../middlewares/auth.cjs") {
          return (req, res, next) => {
            req.user = { id: "mock-owner-id" };
            next();
          };
        }

        if (request === "../middlewares/staffAuth.cjs") {
          return { requireOwner: (req, res, next) => next() };
        }

        if (request === "../services/checkrClient.cjs") {
          return {
            async getCheckrReport(id) {
              assert.equal(id, reportId);
              reportRequested = true;
              return {
                object: "test_report",
                id: reportId,
                status: "complete",
                result: "consider",
                completed_at: "2026-11-01T12:00:00Z",
                package: "mock-package",
                ssn: "000-00-0000",
                dob: "1990-01-01",
              };
            },
          };
        }

        if (request === "../services/driverBackgroundChecks.cjs") {
          return {};
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
      `http://127.0.0.1:${server.address().port}/api/checkr/admin/screening-report/${screeningId}`
    );

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(reportRequested, true);
    assert.equal(body.report.id, reportId);
    assert.equal(body.report.result, "consider");
    assert.equal(body.report.status, "complete");
    assert.equal(body.report.ssn, undefined);
    assert.equal(body.report.dob, undefined);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});
