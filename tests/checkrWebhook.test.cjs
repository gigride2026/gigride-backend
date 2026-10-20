const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const express = require("express");

test("signed Checkr report updates screening and returns 200", async () => {
  const originalLoad = Module._load;
  const originalKey = process.env.CHECKR_API_KEY;
  const testKey = "gigride_webhook_test_only";

  let rpcCalled = false;
  let reportFetched = false;

  const screening = {
    id: "test-screening",
    driver_id: "test-driver",
    checkr_candidate_id: "test-candidate",
    checkr_report_id: null,
    status: "initiating",
  };

  const mockSupabase = {
    from(table) {
      assert.equal(table, "driver_background_checks");
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, "checkr_candidate_id");
              assert.equal(value, "test-candidate");
              return {
                async maybeSingle() {
                  return { data: screening, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      assert.equal(name, "apply_checkr_report_update");
      assert.equal(args.p_candidate_id, "test-candidate");
      assert.equal(args.p_report_id, "test-report");
      assert.equal(args.p_report_status, "complete");
      assert.equal(args.p_report_result, "clear");
      rpcCalled = true;
      return { data: "clear", error: null };
    },
  };

  process.env.CHECKR_API_KEY = testKey;

  try {
    Module._load = function (request, parent, isMain) {
      if (
        request === "../services/checkrClient.cjs" &&
        parent?.filename?.endsWith("checkrWebhook.cjs")
      ) {
        return {
          async getCheckrReport(id) {
            assert.equal(id, "test-report");
            reportFetched = true;
            return {
              id: "test-report",
              candidate_id: "test-candidate",
              status: "complete",
              result: "clear",
              completed_at: "2026-10-20T12:00:00Z",
            };
          },
        };
      }

      if (
        request === "../utils/supabaseAdmin.cjs" &&
        parent?.filename?.endsWith("checkrWebhook.cjs")
      ) {
        return { supabaseAdmin: mockSupabase };
      }

      return originalLoad.apply(this, arguments);
    };

    const routerPath = require.resolve("../routes/checkrWebhook.cjs");
    delete require.cache[routerPath];

    const router = require(routerPath);
    Module._load = originalLoad;

    const app = express();

    app.use(
      express.json({
        verify(req, res, buffer) {
          req.rawBody = Buffer.from(buffer);
        },
      })
    );

    app.use("/api/checkr", router);

    const server = app.listen(0, "127.0.0.1");

    try {
      await new Promise((resolve) =>
        server.once("listening", resolve)
      );

      const body = JSON.stringify({
        type: "report.completed",
        data: {
          object: {
            id: "test-report",
          },
        },
      });

      const signature = crypto
        .createHmac("sha256", testKey)
        .update(body)
        .digest("hex");

      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/checkr/webhook`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Checkr-Signature": signature,
          },
          body,
        }
      );

      assert.equal(response.status, 200);

      assert.deepEqual(await response.json(), {
        ok: true,
        processed: true,
      });

      assert.equal(reportFetched, true);
      assert.equal(rpcCalled, true);

    } finally {
      await new Promise((resolve) =>
        server.close(resolve)
      );
    }

  } finally {
    Module._load = originalLoad;

    if (originalKey === undefined) {
      delete process.env.CHECKR_API_KEY;
    } else {
      process.env.CHECKR_API_KEY = originalKey;
    }
  }
});
test("Checkr webhook returns 503 when Supabase update fails", async () => {
  const originalLoad = Module._load;
  const originalKey = process.env.CHECKR_API_KEY;
  const testKey = "gigride_failure_test_only";

  process.env.CHECKR_API_KEY = testKey;

  try {
    Module._load = function (request, parent, isMain) {
      if (
        request === "../services/checkrClient.cjs" &&
        parent?.filename?.endsWith("checkrWebhook.cjs")
      ) {
        return {
          async getCheckrReport() {
            return {
              id: "failure-test-report",
              candidate_id: "failure-test-candidate",
              status: "complete",
              result: "clear",
            };
          },
        };
      }

      if (
        request === "../utils/supabaseAdmin.cjs" &&
        parent?.filename?.endsWith("checkrWebhook.cjs")
      ) {
        return {
          supabaseAdmin: {
            from() {
              return {
                select() {
                  return {
                    eq() {
                      return {
                        async maybeSingle() {
                          return {
                            data: {
                              id: "failure-test-screening",
                              checkr_report_id: null,
                            },
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
            async rpc() {
              return {
                data: null,
                error: { message: "Simulated database failure" },
              };
            },
          },
        };
      }

      return originalLoad.apply(this, arguments);
    };

    const routerPath = require.resolve("../routes/checkrWebhook.cjs");
    delete require.cache[routerPath];

    const router = require(routerPath);
    Module._load = originalLoad;

    const app = express();
    app.use(express.json({
      verify(req, res, buffer) {
        req.rawBody = Buffer.from(buffer);
      },
    }));
    app.use("/api/checkr", router);

    const server = app.listen(0, "127.0.0.1");

    try {
      await new Promise(resolve => server.once("listening", resolve));

      const body = JSON.stringify({
        type: "report.completed",
        data: { object: { id: "failure-test-report" } },
      });

      const signature = crypto
        .createHmac("sha256", testKey)
        .update(body)
        .digest("hex");

      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/checkr/webhook`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Checkr-Signature": signature,
          },
          body,
        }
      );

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Unable to verify Checkr report",
      });
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    Module._load = originalLoad;

    if (originalKey === undefined) {
      delete process.env.CHECKR_API_KEY;
    } else {
      process.env.CHECKR_API_KEY = originalKey;
    }
  }
});
