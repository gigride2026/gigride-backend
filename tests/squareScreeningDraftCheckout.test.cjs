const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../routes/squareRoutes.cjs"),
  "utf8"
);

test("Square checkout reuse recognizes unpaid DRAFT and OPEN orders", () => {
  assert.match(
    source,
    /\["OPEN",\s*"DRAFT"\]\.includes\(squareOrder\.state\)\s*&&\s*orderTenders\.length\s*===\s*0/
  );
});

test("completed Square orders remain blocked", () => {
  assert.match(
    source,
    /squareOrder\.state\s*===\s*"COMPLETED"/
  );
});
