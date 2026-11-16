const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8");
const colors = {
  buffer: "#B0BDFF", extern: "#adc3e8", alloc: "#C07788", range: "#c8a0e0", LOOP: "#E74856",
  store: "#87CEEB", index: "#CEF9B7", end: "#746c64", after: "#8A7866",
  load: "#ffc0c0", reduce: "#FF5B5B", assert: "#cccccc", or: "#ffffc0",
  add: "#ffffc0", mul: "#ffffc0", max: "#ffffc0", param: "#14686F",
  ALU: "#ffffc0", GLOBAL: "#3B78FF", reshape: "#D8F9E4", permute: "#D8F9E4",
  recip: "#ffffc0", truncdiv: "#ffffc0", truncmod: "#ffffc0", div: "#ffffc0", mod: "#ffffc0",
};

// Exercise activation and editor decorations without launching VS Code.
function highlight(text) {
  const decorations = new Map();
  const editor = {
    document: { languageId: "uir", getText: () => text, positionAt: offset => offset },
    setDecorations: (type, ranges) => decorations.set(type.color, ranges),
  };
  const vscode = {
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    window: {
      visibleTextEditors: [editor],
      createTextEditorDecorationType: options => ({ ...options, dispose() {} }),
      onDidChangeActiveTextEditor() {},
      onDidChangeVisibleTextEditors() {},
    },
    workspace: { onDidChangeTextDocument() {} },
    languages: { registerDefinitionProvider: () => ({ dispose() {} }) },
  };
  const context = { module: { exports: {} }, require: name => {
    assert.equal(name, "vscode");
    return vscode;
  }, setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  context.module.exports.activate();
  const result = [];
  for (const [color, ranges] of decorations) {
    for (const { start, end } of ranges) result.push({ start, end, color });
  }
  context.module.exports.deactivate();
  return result.sort((a, b) => a.start - b.start);
}

function expected(text, tokens) {
  let cursor = 0;
  return tokens.map(token => {
    const start = text.indexOf(token, cursor);
    assert.ok(start >= cursor, `Missing token: ${token}`);
    cursor = start + token.length;
    // A trailing '=' marks an attribute key; only the name receives a decoration.
    const key = token.endsWith("=");
    return { start, end: cursor - (key ? 1 : 0), color: key ? "#888888" : token.startsWith("%") ? "#a0a6b8" : colors[token] };
  });
}

test("named SSA ids and all nested ops use the UIR palette", () => {
  const text = fs.readFileSync(path.join(__dirname, "fixtures/nested.uir"), "utf8");
  const tokens = [
    "%ret", "buffer", "dtype=", "slot=",
    "%alloced", "alloc", "dtype=", "slot=",
    "%loop", "range", "LOOP",
    "%4", "store", "index", "%alloced", "%loop", "%loop",
    "%5", "end", "%4", "%loop",
    "%alloced_after", "after", "%alloced", "%5",
    "%8", "store", "index", "%ret", "load", "index", "after", "%alloced", "%5",
    "%9", "after", "%ret", "%8",
  ];
  assert.deepEqual(highlight(text), expected(text, tokens));
  const crlf = text.replaceAll("\n", "\r\n");
  assert.deepEqual(highlight(crlf), expected(crlf, tokens));
});

test("extern uses its own color without changing buffer highlighting", () => {
  const text = "%x = extern [2 2] slot=0 dtype=f32\n%y = buffer [2 2] slot=1 dtype=f32";
  assert.deepEqual(highlight(text), expected(text, [
    "%x", "extern", "slot=", "dtype=", "%y", "buffer", "slot=", "dtype="
  ]));
});

test("opcode names in SSA definitions never steal the opcode's color", () => {
  const text = "  %index = index %load\n%after = after %index\n%store = store %after";
  assert.deepEqual(highlight(text), expected(text, [
    "%index", "index", "%load", "%after", "after", "%index", "%store", "store", "%after",
  ]));
});

test("comments and escaped strings do not receive op, ref, or axis decorations", () => {
  const text = String.raw`# CONTENTS: b"\x02\x00" LOOP %ret index
; LOOP %ret load
%ret = buffer 1 # LOOP %hidden (after %ret)
%x = load %ret ; LOOP %hidden index
"escaped \" load %hidden LOOP #" 'escaped \' after %hidden LOOP ;'
b"index %hidden LOOP" b'load %hidden LOOP'
"unterminated load %hidden LOOP
%y = after %x`;
  // Expectations start after the comments so hidden words cannot satisfy them.
  const prefixLength = text.indexOf("%ret =");
  const tokens = ["%ret", "buffer", "%x", "load", "%ret", "%y", "after", "%x"];
  const ranges = expected(text.slice(prefixLength), tokens).map(range => ({
    ...range, start: range.start + prefixLength, end: range.end + prefixLength,
  }));
  assert.deepEqual(highlight(text), ranges);
});

test("studentgrad nested lexical scopes preserve SSA and arithmetic colors", () => {
  const text = fs.readFileSync(path.join(__dirname, "fixtures/studentgrad.uir"), "utf8");
  assert.deepEqual(highlight(text), expected(text, [
    "%value", "%block", "%value", "add", "%value", "%inner", "%value", "mul", "%value",
    "%result", "add", "%value", "%result", "add", "%value", "%inner", "%result", "add", "%value", "%block",
  ]));
});

test("attribute keys are muted gray while address spaces and op values retain their colors", () => {
  const text = `%p = param [] : dtype=int slot=0 addrspace=ALU min=-2 max=2
%b = buffer [2 2] : dtype=float slot=0 addrspace=GLOBAL
%m = reshape [true false -0x2a 1e-3] [2 2]
%t = permute %m [1 0]
%r = reduce %t : op=max pop=1 # ALU %hidden max
ALU=1 GLOBAL=2`;
  assert.deepEqual(highlight(text), expected(text, [
    "%p", "param", "dtype=", "slot=", "addrspace=", "ALU", "min=", "max=",
    "%b", "buffer", "dtype=", "slot=", "addrspace=", "GLOBAL", "%m", "reshape",
    "%t", "permute", "%m", "%r", "reduce", "%t", "op=", "max", "pop=", "ALU=", "GLOBAL=",
  ]));
});

test("renamed tinygrad ALU ops retain their colors while refs and keys use their own colors", () => {
  for (const op of ["recip", "truncdiv", "truncmod", "div", "mod"]) {
    const text = `%${op} = ${op} (${op} %x) : ${op}=1 ${op}_suffix=2 # ${op}\n"${op}"`;
    assert.deepEqual(highlight(text), expected(text, [`%${op}`, op, op, "%x", `${op}=`, `${op}_suffix=`]));
  }
  assert.deepEqual(highlight("reciprocal cdiv cmod floordiv floormod"), []);
});

test("assert explicitly matches Dark Modern foreground while SSA references remain gray", () => {
  const text = `%assert = assert %expr 7
%test = assert %assert 7
assert=1 assert_suffix=2 # assert %hidden
"assert %hidden"`;
  assert.deepEqual(highlight(text), expected(text, [
    "%assert", "assert", "%expr", "%test", "assert", "%assert", "assert=", "assert_suffix=",
  ]));
});

test("reduce op arguments retain their color while all attribute names are muted", () => {
  const text = "%r = reduce %x : op=or index=0 LOOP=1 index_suffix=2 constructor=3";
  assert.deepEqual(highlight(text), expected(text, [
    "%r", "reduce", "%x", "op=", "or", "index=", "LOOP=", "index_suffix=", "constructor=",
  ]));
});

test("attribute decorations exclude equals, values, comments, and strings", () => {
  const text = `%slot=7
%b = buffer [] slot=0 dtype=i32 # slot=1 dtype=f32
%r = reduce %b op=add pop=1 ; op=max pop=2
"slot=3" 'dtype=bool'`;
  assert.deepEqual(highlight(text), expected(text, [
    "%slot", "%b", "buffer", "slot=", "dtype=", "%r", "reduce", "%b", "op=", "add", "pop=",
  ]));
});
