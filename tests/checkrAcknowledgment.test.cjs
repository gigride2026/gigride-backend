const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");

test("screening acknowledgment requires explicit confirmation", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");

  let databaseAccessed = false;
  let server;

  const mockSupabase = {
    from() {
      databaseAccessed = true;
      throw new Error("Database should not be accessed");
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

    await new Promise(resolve => server.once("listening", resolve));

    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: false }),
      }
    );

    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).code,
      "SCREENING_ACKNOWLEDGMENT_REQUIRED"
    );
    assert.equal(databaseAccessed, false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("authenticated driver can record screening acknowledgment", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");

  let savedDriverId = null;
  let savedValues = null;
  let server;

  const mockSupabase = {
    from(table) {
      if (table === "bookings") {
        const filters = {};
        const query = {
          select(column) {
            assert.equal(column, "id");
            return this;
          },
          eq(column, value) {
            filters[column] = value;
            return this;
          },
          async maybeSingle() {
            assert.deepEqual(filters, {
              id: "11111111-1111-4111-8111-111111111111",
              driver_id: "test-driver-id",
              host_approved: true,
            });
            return {
              data: { id: filters.id },
              error: null,
            };
          },
        };
        return query;
      }

      assert.equal(table, "driver_background_checks");

      return {
        select() {
          return {
            eq(field, value) {
              assert.equal(field, "driver_id");
              assert.equal(value, "test-driver-id");

              return {
                async maybeSingle() {
                  return {
                    data: { screening_acknowledged_at: null },
                    error: null,
                  };
                },
              };
            },
          };
        },

        update(values) {
          savedValues = values;

          return {
            eq(field, value) {
              assert.equal(field, "driver_id");
              savedDriverId = value;
              return this;
            },
            is(field, value) {
              assert.equal(field, "screening_acknowledged_at");
              assert.equal(value, null);
              return this;
            },
            select() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      screening_acknowledged_at:
                        savedValues.screening_acknowledged_at,
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
      `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acknowledged: true,
          driver_id: "another-driver-id",
          booking_id: "11111111-1111-4111-8111-111111111111",
        }),
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      acknowledged: true,
      already_recorded: false,
    });

    assert.equal(savedDriverId, "test-driver-id");
    assert.ok(
      !Number.isNaN(Date.parse(savedValues.screening_acknowledged_at))
    );
    assert.deepEqual(Object.keys(savedValues), [
      "screening_acknowledged_at",
    ]);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("existing screening acknowledgment is not overwritten", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");
  const originalTimestamp = "2026-10-25T12:00:00Z";

  let updateCalled = false;
  let upsertCalled = false;
  let server;

  const existingRecord = {
    screening_acknowledged_at: originalTimestamp,
    fee_amount_cents: 3949,
    fee_payment_status: "paid",
    square_payment_id: "existing-square-payment",
    status: "complete",
  };

  const mockSupabase = {
    from(table) {
      if (table === "bookings") {
        const filters = {};
        return {
          select(column) {
            assert.equal(column, "id");
            return this;
          },
          eq(column, value) {
            filters[column] = value;
            return this;
          },
          async maybeSingle() {
            assert.deepEqual(filters, {
              id: "11111111-1111-4111-8111-111111111111",
              driver_id: "test-driver-id",
              host_approved: true,
            });
            return {
              data: { id: filters.id },
              error: null,
            };
          },
        };
      }

      assert.equal(table, "driver_background_checks");

      return {
        select(field) {
          assert.equal(field, "screening_acknowledged_at");

          return {
            eq(column, value) {
              assert.equal(column, "driver_id");
              assert.equal(value, "test-driver-id");

              return {
                async maybeSingle() {
                  return {
                    data: {
                      screening_acknowledged_at: existingRecord.screening_acknowledged_at,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },

        update() {
          updateCalled = true;
          throw new Error("Existing acknowledgment must not be overwritten");
        },
        upsert() {
          upsertCalled = true;
          throw new Error("Existing paid screening record must not be replaced");
        },
      };
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
      `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true, booking_id: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      acknowledged: true,
      already_recorded: true,
    });

    assert.equal(updateCalled, false);
    assert.equal(upsertCalled, false);
    assert.deepEqual(existingRecord, {
      screening_acknowledged_at: originalTimestamp,
      fee_amount_cents: 3949,
      fee_payment_status: "paid",
      square_payment_id: "existing-square-payment",
      status: "complete",
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("screening acknowledgment rejects unauthenticated requests", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");

  let databaseAccessed = false;
  let server;

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return {
            supabaseAdmin: {
              from() {
                databaseAccessed = true;
                throw new Error("Database must not be accessed");
              },
            },
          };
        }

        if (request === "../middlewares/auth.cjs") {
          return (req, res, next) => {
            if (!req.headers.authorization) {
              return res.status(401).json({
                error: "Authentication required.",
              });
            }
            req.user = { id: "test-driver-id" };
            next();
          };
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
      `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true }),
      }
    );

    assert.equal(response.status, 401);
    assert.equal(databaseAccessed, false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("screening acknowledgment fails safely on database lookup errors", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");

  let updateCalled = false;
  let server;

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return {
            supabaseAdmin: {
              from(table) {
                if (table === "bookings") {
                  const filters = {};
                  return {
                    select(column) {
                      assert.equal(column, "id");
                      return this;
                    },
                    eq(column, value) {
                      filters[column] = value;
                      return this;
                    },
                    async maybeSingle() {
                      assert.deepEqual(filters, {
                        id: "11111111-1111-4111-8111-111111111111",
                        driver_id: "test-driver-id",
                        host_approved: true,
                      });
                      return {
                        data: { id: filters.id },
                        error: null,
                      };
                    },
                  };
                }

                assert.equal(table, "driver_background_checks");

                return {
                  select() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: null,
                              error: new Error("Simulated database failure"),
                            };
                          },
                        };
                      },
                    };
                  },
                  update() {
                    updateCalled = true;
                    throw new Error("Update must not be attempted");
                  },
                };
              },
            },
          };
        }

        if (request === "../middlewares/auth.cjs") {
          return (req, res, next) => {
            req.user = { id: "test-driver-id" };
            next();
          };
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
      `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true, booking_id: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Unable to record screening acknowledgment.",
    });
    assert.equal(updateCalled, false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("screening status returns acknowledgment false when no record exists", async () => {
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
            req.user = { id: "test-driver-id" };
            next();
          };
        }
        if (request === "../services/checkrClient.cjs") return {};
        if (request === "../services/driverBackgroundChecks.cjs") {
          return {
            async getDriverBackgroundCheck(db, driverId) {
              assert.equal(driverId, "test-driver-id");
              return null;
            },
            isRentalScreeningEligible() {
              throw new Error("Eligibility must not be checked without a record");
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
      `http://127.0.0.1:${server.address().port}/api/checkr/my-screening`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      screening_required: true,
      fee_paid: false,
      fee_pending: false,
      screening_acknowledged: false,
      screening_status: "not_started",
      rental_eligible: false,
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("screening status returns acknowledgment true for an acknowledged driver", async () => {
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
                status: "not_started",
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
      `http://127.0.0.1:${server.address().port}/api/checkr/my-screening`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      screening_required: true,
      fee_paid: true,
      fee_pending: false,
      screening_acknowledged: true,
      screening_status: "not_started",
      rental_eligible: false,
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("screening acknowledgment returns 409 when database update is not confirmed", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");
  let server;

  const mockSupabase = {
    from(table) {
      if (table === "bookings") {
        const filters = {};
        return {
          select(column) {
            assert.equal(column, "id");
            return this;
          },
          eq(column, value) {
            filters[column] = value;
            return this;
          },
          async maybeSingle() {
            assert.deepEqual(filters, {
              id: "11111111-1111-4111-8111-111111111111",
              driver_id: "test-driver-id",
              host_approved: true,
            });
            return {
              data: { id: filters.id },
              error: null,
            };
          },
        };
      }

      assert.equal(table, "driver_background_checks");
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: { screening_acknowledged_at: null },
                    error: null,
                  };
                },
              };
            },
          };
        },
        update(values) {
          assert.ok(values.screening_acknowledged_at);
          return {
            eq() { return this; },
            is() { return this; },
            select() {
              return {
                async maybeSingle() {
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
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
      `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true, booking_id: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    assert.equal(response.status, 409);
    assert.equal(
      (await response.json()).code,
      "SCREENING_ACKNOWLEDGMENT_NOT_CONFIRMED"
    );
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("first-time driver acknowledgment creates an unpaid screening record without initiating screening", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");
  const bookingId = "11111111-1111-4111-8111-111111111111";
  let server;
  let savedRecord = null;
  let insertCount = 0;

  const mockSupabase = {
    from(table) {
      if (table === "bookings") {
        const filters = {};
        return {
          select(column) {
            assert.equal(column, "id");
            return this;
          },
          eq(column, value) {
            filters[column] = value;
            return this;
          },
          async maybeSingle() {
            assert.deepEqual(filters, {
              id: bookingId,
              driver_id: "test-driver-id",
              host_approved: true,
            });
            return { data: { id: bookingId }, error: null };
          },
        };
      }

      assert.equal(table, "driver_background_checks");

      return {
        select(column) {
          assert.equal(column, "screening_acknowledged_at");
          return {
            eq(field, value) {
              assert.equal(field, "driver_id");
              assert.equal(value, "test-driver-id");
              return {
                async maybeSingle() {
                  return {
                    data: savedRecord
                      ? { screening_acknowledged_at: savedRecord.screening_acknowledged_at }
                      : null,
                    error: null,
                  };
                },
              };
            },
          };
        },
        async upsert(values, options) {
          insertCount++;
          assert.deepEqual(options, {
            onConflict: "driver_id",
            ignoreDuplicates: true,
          });
          assert.equal(values.driver_id, "test-driver-id");
          assert.equal(values.first_booking_id, bookingId);
          assert.equal(values.fee_amount_cents, 3949);
          assert.equal(values.fee_payment_status, "unpaid");
          assert.equal(values.status, "not_started");
          assert.ok(!Number.isNaN(Date.parse(values.screening_acknowledged_at)));
          assert.equal(values.authorization_confirmed_at, undefined);
          assert.equal(values.square_payment_id, undefined);
          assert.equal(values.checkr_candidate_id, undefined);
          savedRecord = { ...values };
          return { error: null };
        },
        update() {
          throw new Error("First-time driver must use insert path");
        },
      };
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
      `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acknowledged: true,
          booking_id: bookingId,
        }),
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      acknowledged: true,
      already_recorded: false,
    });
    assert.equal(insertCount, 1);
    assert.ok(savedRecord);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("screening acknowledgment rejects bookings not approved for the authenticated driver", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");
  const bookingId = "11111111-1111-4111-8111-111111111111";
  let server;
  let screeningAccessed = false;
  let bookingLookupCount = 0;

  const mockSupabase = {
    from(table) {
      if (table === "bookings") {
        const filters = {};
        return {
          select(column) {
            assert.equal(column, "id");
            return this;
          },
          eq(column, value) {
            filters[column] = value;
            return this;
          },
          async maybeSingle() {
            bookingLookupCount++;
            assert.deepEqual(filters, {
              id: bookingId,
              driver_id: "test-driver-id",
              host_approved: true,
            });
            return { data: null, error: null };
          },
        };
      }

      screeningAccessed = true;
      throw new Error("Unauthorized booking must not access screening records");
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
      `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acknowledged: true,
          booking_id: bookingId,
        }),
      }
    );

    assert.equal(response.status, 403);
    assert.equal(
      (await response.json()).code,
      "SCREENING_BOOKING_NOT_APPROVED"
    );
    assert.equal(bookingLookupCount, 1);
    assert.equal(screeningAccessed, false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("screening acknowledgment rejects missing and invalid booking IDs", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");
  let server;
  let databaseAccessed = false;

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return {
            supabaseAdmin: {
              from() {
                databaseAccessed = true;
                throw new Error("Invalid booking must not access database");
              },
            },
          };
        }
        if (request === "../middlewares/auth.cjs") {
          return (req, res, next) => {
            req.user = { id: "test-driver-id" };
            next();
          };
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

    for (const bookingId of [undefined, "", "not-a-uuid", 123]) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acknowledged: true,
            booking_id: bookingId,
          }),
        }
      );

      assert.equal(response.status, 400);
      assert.equal(
        (await response.json()).code,
        "SCREENING_BOOKING_REQUIRED"
      );
    }

    assert.equal(databaseAccessed, false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test("paid driver can acknowledge without resetting payment or screening status", async () => {
  const originalLoad = Module._load;
  const routePath = require.resolve("../routes/checkrRoutes.cjs");
  const bookingId = "11111111-1111-4111-8111-111111111111";
  let server;
  let updateCount = 0;

  const record = {
    driver_id: "test-driver-id",
    screening_acknowledged_at: null,
    fee_amount_cents: 3949,
    fee_payment_status: "paid",
    square_payment_id: "existing-square-payment",
    status: "complete",
    checkr_report_id: "existing-checkr-report",
  };

  const mockSupabase = {
    from(table) {
      if (table === "bookings") {
        const filters = {};
        return {
          select(column) {
            assert.equal(column, "id");
            return this;
          },
          eq(column, value) {
            filters[column] = value;
            return this;
          },
          async maybeSingle() {
            assert.deepEqual(filters, {
              id: bookingId,
              driver_id: record.driver_id,
              host_approved: true,
            });
            return { data: { id: bookingId }, error: null };
          },
        };
      }

      assert.equal(table, "driver_background_checks");

      return {
        select(column) {
          assert.equal(column, "screening_acknowledged_at");
          return {
            eq(field, value) {
              assert.equal(field, "driver_id");
              assert.equal(value, record.driver_id);
              return {
                async maybeSingle() {
                  return {
                    data: {
                      screening_acknowledged_at: record.screening_acknowledged_at,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
        update(values) {
          updateCount++;
          assert.deepEqual(Object.keys(values), ["screening_acknowledged_at"]);
          assert.ok(!Number.isNaN(Date.parse(values.screening_acknowledged_at)));

          return {
            eq(field, value) {
              assert.equal(field, "driver_id");
              assert.equal(value, record.driver_id);
              return this;
            },
            is(field, value) {
              assert.equal(field, "screening_acknowledged_at");
              assert.equal(value, null);
              return this;
            },
            select(column) {
              assert.equal(column, "screening_acknowledged_at");
              return {
                async maybeSingle() {
                  record.screening_acknowledged_at =
                    values.screening_acknowledged_at;
                  return {
                    data: {
                      screening_acknowledged_at: record.screening_acknowledged_at,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
        upsert() {
          throw new Error("Existing paid record must not be replaced");
        },
      };
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
            req.user = { id: record.driver_id };
            next();
          };
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
      `http://127.0.0.1:${server.address().port}/api/checkr/acknowledge-screening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acknowledged: true,
          booking_id: bookingId,
        }),
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      acknowledged: true,
      already_recorded: false,
    });

    assert.equal(updateCount, 1);
    assert.ok(record.screening_acknowledged_at);
    assert.equal(record.fee_amount_cents, 3949);
    assert.equal(record.fee_payment_status, "paid");
    assert.equal(record.square_payment_id, "existing-square-payment");
    assert.equal(record.status, "complete");
    assert.equal(record.checkr_report_id, "existing-checkr-report");
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});
