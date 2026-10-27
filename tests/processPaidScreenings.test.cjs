
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const SERVICE_PATH = require.resolve(
  "../services/processPaidScreenings.cjs"
);

async function withMockedWorker(options, callback) {
  const originalLoad = Module._load;
  const originalWorkerFlag =
    process.env.CHECKR_SCREENING_WORKER_ENABLED;
  const originalInitiationFlag =
    process.env.CHECKR_SCREENING_INITIATION_ENABLED;

  const {
    workerEnabled = true,
    initiationEnabled = true,
    driverIds = ["driver-1", "driver-2"],
    failDriver = null,
    databaseError = null,
  } = options;

  const calls = {
    queries: 0,
    started: [],
    authorizationFilters: 0,
  };

  process.env.CHECKR_SCREENING_WORKER_ENABLED =
    String(workerEnabled);
  process.env.CHECKR_SCREENING_INITIATION_ENABLED =
    String(initiationEnabled);

  const supabaseAdmin = {
    from(table) {
      assert.equal(table, "driver_background_checks");
      calls.queries++;

      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        not(column, operator, value) {
          assert.equal(column, "authorization_confirmed_at");
          assert.equal(operator, "is");
          assert.equal(value, null);
          calls.authorizationFilters++;
          return this;
        },
        is() {
          return this;
        },
        order() {
          return this;
        },
        async limit(value) {
          assert.equal(value, 10);

          return {
            data: driverIds.map((driver_id) => ({
              driver_id,
            })),
            error: databaseError
              ? { message: databaseError }
              : null,
          };
        },
      };
    },
  };

  async function startDriverScreening(driverId) {
    calls.started.push(driverId);

    if (driverId === failDriver) {
      throw new Error("Simulated screening failure");
    }

    return {
      success: true,
      status: "invitation_created",
    };
  }

  try {
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === SERVICE_PATH) {
        if (request === "../utils/supabaseAdmin.cjs") {
          return { supabaseAdmin };
        }

        if (request === "./startDriverScreening.cjs") {
          return { startDriverScreening };
        }
      }

      return originalLoad.apply(this, arguments);
    };

    delete require.cache[SERVICE_PATH];

    const { processPaidScreenings } =
      require(SERVICE_PATH);

    await callback(processPaidScreenings, calls);
  } finally {
    Module._load = originalLoad;
    delete require.cache[SERVICE_PATH];

    if (originalWorkerFlag === undefined) {
      delete process.env.CHECKR_SCREENING_WORKER_ENABLED;
    } else {
      process.env.CHECKR_SCREENING_WORKER_ENABLED =
        originalWorkerFlag;
    }

    if (originalInitiationFlag === undefined) {
      delete process.env.CHECKR_SCREENING_INITIATION_ENABLED;
    } else {
      process.env.CHECKR_SCREENING_INITIATION_ENABLED =
        originalInitiationFlag;
    }
  }
}

test("disabled worker does not query or start screenings", async () => {
  await withMockedWorker(
    { workerEnabled: false },
    async (run, calls) => {
      const result = await run();

      assert.equal(result.enabled, false);
      assert.equal(result.processed, 0);
      assert.equal(calls.queries, 0);
      assert.deepEqual(calls.started, []);
    }
  );
});

test("disabled initiation prevents worker processing", async () => {
  await withMockedWorker(
    { initiationEnabled: false },
    async (run, calls) => {
      const result = await run();

      assert.equal(result.enabled, false);
      assert.equal(result.processed, 0);
      assert.equal(calls.queries, 0);
      assert.deepEqual(calls.started, []);
    }
  );
});

test("worker processes eligible paid screenings", async () => {
  await withMockedWorker({}, async (run, calls) => {
    const result = await run();

    assert.equal(result.enabled, true);
    assert.equal(result.processed, 2);
    assert.deepEqual(calls.started, [
      "driver-1",
      "driver-2",
    ]);
  });
});

test("worker handles an empty screening queue", async () => {
  await withMockedWorker(
    { driverIds: [] },
    async (run, calls) => {
      const result = await run();

      assert.equal(result.enabled, true);
      assert.equal(result.processed, 0);
      assert.deepEqual(calls.started, []);
    }
  );
});

test("worker stops processing after a screening failure", async () => {
  await withMockedWorker(
    {
      driverIds: ["driver-1", "driver-2", "driver-3"],
      failDriver: "driver-2",
    },
    async (run, calls) => {
      const originalError = console.error;
      console.error = () => {};

      try {
        const result = await run();

        assert.equal(result.enabled, true);
        assert.equal(result.processed, 1);
        assert.deepEqual(calls.started, [
          "driver-1",
          "driver-2",
        ]);
      } finally {
        console.error = originalError;
      }
    }
  );
});

test("worker propagates database query errors", async () => {
  await withMockedWorker(
    { databaseError: "Simulated database failure" },
    async (run, calls) => {
      await assert.rejects(
  run(),
  (error) => error.message === "Simulated database failure"
);

      assert.equal(calls.queries, 1);
      assert.deepEqual(calls.started, []);
    }
  );
});

test("worker requires the authorization timestamp filter", async () => {
  await withMockedWorker(
    { driverIds: [] },
    async (run, calls) => {
      await run();

      assert.equal(calls.queries, 1);
      assert.equal(calls.authorizationFilters, 1);
      assert.deepEqual(calls.started, []);
    }
  );
});
