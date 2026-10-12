const assert = require("node:assert/strict");
const { test } = require("node:test");
const config = require("../language-configuration.json");

test("bracket matching declares both ends of each UIR bracket pair", () => {
  assert.deepEqual(config.brackets, [["{", "}"], ["(", ")"], ["[", "]"]]);
});
