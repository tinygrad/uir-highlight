const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { Registry, parseRawGrammar } = require("vscode-textmate");
const { loadWASM, createOnigScanner, createOnigString } = require("vscode-oniguruma");

const grammarPath = path.join(__dirname, "../syntaxes/uir.tmLanguage.json");
const registry = new Registry({
  onigLib: loadWASM(fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")))
    .then(() => ({ createOnigScanner, createOnigString })),
  loadGrammar: async () => parseRawGrammar(fs.readFileSync(grammarPath, "utf8"), grammarPath),
});
const grammar = registry.loadGrammar("source.uir");

async function tokenize(text) {
  const loaded = await grammar;
  let state;
  const tokens = [];
  for (const line of text.split(/\r?\n/)) {
    const result = loaded.tokenizeLine(line, state);
    state = result.ruleStack;
    for (const token of result.tokens) {
      const value = line.slice(token.startIndex, token.endIndex);
      if (value.trim()) tokens.push({ value, scope: token.scopes.at(-1) });
    }
  }
  return tokens;
}

async function assertScope(text, scope) {
  assert.deepEqual(await tokenize(text), [{ value: text, scope }]);
}

test("renamed tinygrad ALU ops have dedicated scopes and respect token boundaries", async () => {
  for (const op of ["recip", "truncdiv", "truncmod", "div", "mod"]) {
    await assertScope(op, `keyword.other.op.uir.${op}`);
    await assertScope(`%${op}`, "variable.other.ssa.uir");
    await assertScope(`${op}_suffix`, "source.uir");
    const tokens = await tokenize(`%result = ${op} (${op} %x) : ${op}=1`);
    assert.deepEqual(tokens.filter(t => t.scope.startsWith("keyword.other.op")).map(t => t.value), [op, op]);
    assert.deepEqual(tokens.filter(t => t.scope === "variable.parameter.key.uir").map(t => t.value), [op]);
  }
  for (const op of ["reciprocal", "cdiv", "cmod", "floordiv", "floormod"]) await assertScope(op, "source.uir");
});

test("studentgrad assert has an opcode scope without stealing refs or attribute keys", async () => {
  await assertScope("assert", "keyword.other.op.uir.assert");
  await assertScope("%assert", "variable.other.ssa.uir");
  await assertScope("assert_suffix", "source.uir");
  const tokens = await tokenize("%test = assert %expr 7 assert=1 # assert %hidden");
  assert.deepEqual(tokens.filter(t => t.scope === "keyword.other.op.uir.assert").map(t => t.value), ["assert"]);
  assert.deepEqual(tokens.filter(t => t.scope === "variable.other.ssa.uir").map(t => t.value), ["%test", "%expr"]);
  assert.deepEqual(tokens.filter(t => t.scope === "variable.parameter.key.uir").map(t => t.value), ["assert"]);
});

test("studentgrad literals are single tokens, including signs and exponents", async () => {
  for (const literal of ["0", "-1", "2147483648"]) await assertScope(literal, "constant.numeric.uir");
  for (const literal of ["0x0000002a", "0xffffffff", "-0x2a", "0x1B73E040", "0xBBE0CC", "0xD81C68", "0x8C7F94", "-0xAbCd"]) {
    await assertScope(literal, "constant.numeric.hex-integer.uir");
  }
  for (const literal of ["0.0", "-0.0", "1.25", "-1.25e-3", "1e40", "1e+10", "inf", "-inf", "nan", "-nan"]) {
    await assertScope(literal, "constant.numeric.float.uir");
  }
  for (const literal of ["true", "false"]) await assertScope(literal, "constant.language.boolean.uir");
  await assertScope("-0x1.ap+2", "constant.numeric.hex-float.uir");
});

test("types, address spaces, and attribute keys take precedence over op names", async () => {
  for (const dtype of ["void", "bool", "i32", "f32", "int", "float"]) await assertScope(dtype, "support.type.dtype.uir");
  for (const space of ["GLOBAL", "ALU"]) await assertScope(space, "constant.other.addrspace.uir");
  await assertScope("LOOP", "constant.other.axistype.uir");
  const tokens = await tokenize("param [] : dtype=int slot=0 addrspace=ALU min=-4 max=4\nreduce %x : op=add pop=1");
  assert.deepEqual(tokens.filter(t => t.scope === "variable.parameter.key.uir").map(t => t.value),
    ["dtype", "slot", "addrspace", "min", "max", "op", "pop"]);
  assert.deepEqual(tokens.filter(t => t.scope.startsWith("keyword.other.op")).map(t => t.value), ["param", "reduce", "add"]);
});

test("nested scopes highlight indented SSA assignments and delimiters", async () => {
  const text = fs.readFileSync(path.join(__dirname, "fixtures/studentgrad.uir"), "utf8");
  const tokens = await tokenize(text);
  assert.deepEqual(await tokenize(text.replaceAll("\n", "\r\n")), tokens);
  assert.equal(tokens.filter(t => t.scope === "keyword.operator.assignment.uir").length, 8);
  assert.equal(tokens.filter(t => t.scope === "variable.other.ssa.uir").length, 15);
  assert.deepEqual(tokens.filter(t => t.scope === "punctuation.section.block.uir").map(t => t.value), ["{", "{", "}", "}"]);
  assert.ok(!tokens.some(t => t.scope === "source.uir"));
});

test("multiline stack literals and nested expressions retain structural scopes", async () => {
  const tokens = await tokenize("%matrix = reshape [\n  [1 2], [3 4]\n] [2 2]\n%x = (cast (index %matrix 0) : float)");
  assert.equal(tokens.filter(t => t.scope === "punctuation.section.brackets.uir").length, 8);
  assert.equal(tokens.filter(t => t.scope === "punctuation.section.parens.uir").length, 4);
  assert.ok(!tokens.some(t => t.scope === "source.uir"));
});

test("comments and escaped strings shield their contents from syntax rules", async () => {
  for (const comment of ["# CONTENTS: [true, -inf]", "# REJECTED", "; legacy load %x"]) {
    await assertScope(comment, "comment.line.uir");
  }
  await assertScope('# EXPECT: load %x', "comment.line.expect.uir");
  await assertScope(String.raw`b"escaped \" load %x # ALU"`, "string.quoted.double.uir");
  await assertScope(String.raw`'escaped \' max=1 %x ;'`, "string.quoted.single.uir");
  await assertScope('"unterminated load %x', "string.quoted.double.uir");
});
