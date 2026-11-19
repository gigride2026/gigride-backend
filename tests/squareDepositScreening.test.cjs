const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Square deposit and rental checkout both require screening clearance", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../routes/squareRoutes.cjs"),
    "utf8"
  );

  const start = source.indexOf('router.post("/create-payment-link"');
  const end = source.indexOf('let squareAccessToken', start);

  assert.ok(start >= 0, "Payment endpoint must exist");
  assert.ok(end > start, "Payment authorization section must exist");

  const authorization = source.slice(start, end);

  assert.match(
    authorization,
    /payment_type === "deposit" \|\| payment_type === "rental"/
  );

  assert.match(
    authorization,
    /isRentalScreeningEligible\(screening\)/
  );

  assert.match(
    authorization,
    /res\.status\(409\)/
  );
});
