const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8");
const colors = {
  buffer: "#B0BDFF", alloc: "#C07788", range: "#c8a0e0", LOOP: "#E74856",
  store: "#87CEEB", index: "#CEF9B7", end: "#524C46", after: "#8A7866",
  load: "#ffc0c0", reduce: "#FF5B5B", or: "#ffffc0",
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
    return { start, end: cursor, color: token.startsWith("%") ? "#a0a6b8" : colors[token] };
  });
}

test("named SSA ids and all nested ops use exact tinygrad colors", () => {
  const text = fs.readFileSync(path.join(__dirname, "fixtures/nested.uir"), "utf8");
  const tokens = [
    "%ret", "buffer",
    "%alloced", "alloc",
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

test("reduce op arguments are colored, but keys and longer identifiers are not", () => {
  const text = "%r = reduce %x : op=or index=0 LOOP=1 index_suffix=2 constructor=3";
  assert.deepEqual(highlight(text), expected(text, ["%r", "reduce", "%x", "or"]));
});
