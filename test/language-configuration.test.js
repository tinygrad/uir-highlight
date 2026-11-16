const assert = require("node:assert/strict");
const { test } = require("node:test");
const config = require("../language-configuration.json");

test("bracket matching declares both ends of each UIR bracket pair", () => {
  assert.deepEqual(config.brackets, [["{", "}"], ["(", ")"], ["[", "]"]]);
  for (const pairs of [config.autoClosingPairs, config.surroundingPairs]) {
    for (const [open, close] of config.brackets) assert.ok(pairs.some(p => p.open === open && p.close === close));
  }
});

test("comment shortcut uses studentgrad's comment syntax", () => {
  assert.equal(config.comments.lineComment, "#");
});

test("folding supports scoped blocks and legacy named range/end definitions", () => {
  const start = new RegExp(config.folding.markers.start);
  const end = new RegExp(config.folding.markers.end);
  for (const line of ["%block = {", "  %inner = {", "  {", "%loop = range 4 : LOOP 0"]) assert.match(line, start);
  for (const line of ["}", "  }", "%done = end %write %loop"]) assert.match(line, end);
  assert.doesNotMatch("# %block = {", start);
  assert.doesNotMatch("%value = add 1 2", start);
});
