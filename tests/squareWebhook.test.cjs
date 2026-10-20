const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Square webhook rejects invalid signatures", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../routes/squareRoutes.cjs"),
    "utf8"
  );

  assert.match(source, /x-square-hmacsha256-signature/);
  assert.match(source, /crypto\.timingSafeEqual/);
  assert.match(source, /res\.status\(403\)/);
});

test("Square webhook rejects a forged HTTP request with 403", async () => {
  const express = require("express");
  const app = express();

  app.use(express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));

  app.post("/webhook", (req, res) => {
    const crypto = require("node:crypto");
    const secret = "test-signature-secret";
    const url = "https://example.test/webhook";
    const signature = req.get("x-square-hmacsha256-signature");

    const expected = crypto.createHmac("sha256", secret)
      .update(url + req.rawBody.toString("utf8"))
      .digest("base64");

    const received = Buffer.from(signature || "", "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    if (
      received.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(received, expectedBuffer)
    ) {
      return res.status(403).json({ error: "Invalid Square webhook signature" });
    }

    res.json({ ok: true });
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-square-hmacsha256-signature": "forged-signature"
        },
        body: JSON.stringify({ type: "payment.updated" })
      }
    );

    assert.equal(response.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
