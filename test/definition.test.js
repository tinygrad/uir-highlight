const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8");

function loadProvider() {
  let provider;
  let registrationDisposed = false;
  const vscode = {
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    Location: class { constructor(uri, range) { this.uri = uri; this.range = range; } },
    window: {
      visibleTextEditors: [],
      createTextEditorDecorationType: () => ({ dispose() {} }),
      onDidChangeActiveTextEditor() {},
      onDidChangeVisibleTextEditors() {},
      onDidChangeTextEditorSelection() { return { dispose() {} }; },
    },
    workspace: { onDidChangeTextDocument() {} },
    languages: {
      registerDefinitionProvider(selector, value) {
        assert.equal(selector, "uir");
        provider = value;
        return { dispose() { registrationDisposed = true; } };
      },
      registerHoverProvider() { return { dispose() {} }; },
    },
    commands: { executeCommand() {} },
  };
  const context = { module: { exports: {} }, require: name => {
    if (name === "vscode") return vscode;
    assert.equal(name, "./uir-types");
    return require(path.join(__dirname, "../uir-types.js"));
  }, setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  context.module.exports.activate();
  assert.ok(provider);
  return {
    provider,
    deactivate: context.module.exports.deactivate,
    get registrationDisposed() { return registrationDisposed; },
  };
}

function document(text) {
  return {
    uri: "test.uir",
    getText: () => text,
    offsetAt: position => position,
    positionAt: offset => offset,
  };
}

function definitionOffsets(provider, text, useOffset) {
  const result = provider.provideDefinition(document(text), useOffset);
  return result && Array.from(result, location => ({
    uri: location.uri,
    start: location.range.start,
    end: location.range.end,
  }));
}

test("a use jumps to its SSA definition, ignoring comments and strings", () => {
  const { provider, deactivate } = loadProvider();
  const text = `# %value = hidden\n%value = buffer [1]\n"%quoted = hidden"\n%result = load %value`;
  const use = text.lastIndexOf("%value");
  const definition = text.indexOf("%value = buffer");
  assert.deepEqual(definitionOffsets(provider, text, use + 2), [
    { uri: "test.uir", start: definition, end: definition + "%value".length },
  ]);
  deactivate();
});

test("numeric SSA uses jump to their assignment", () => {
  const { provider, deactivate } = loadProvider();
  const text = `%22 = buffer [1]\n%43396 = linear %22 [1]`;
  assert.deepEqual(definitionOffsets(provider, text, text.lastIndexOf("%22") + 1), [
    { uri: "test.uir", start: 0, end: 3 },
  ]);
  deactivate();
});

test("shadowed definitions are all offered to VS Code's definition picker", () => {
  const { provider, deactivate } = loadProvider();
  const text = fs.readFileSync(path.join(__dirname, "fixtures/studentgrad.uir"), "utf8");
  const use = text.indexOf("%value", text.lastIndexOf("%result ="));
  const locations = definitionOffsets(provider, text, use + 1);
  assert.deepEqual(locations.map(location => text.slice(location.start, location.end)), ["%value", "%value", "%value"]);
  assert.deepEqual(locations.map(location => location.start),
    Array.from(text.matchAll(/%value(?=\s*=)/g), match => match.index));
  deactivate();
});

test("non-references, missing definitions, comments, and strings have no target", () => {
  const loaded = loadProvider();
  const text = `%value = buffer [1]\n%result = add %missing 1\n# %value\n"%value"`;
  assert.equal(loaded.provider.provideDefinition(document(text), text.indexOf("buffer")), null);
  assert.equal(loaded.provider.provideDefinition(document(text), text.lastIndexOf("%missing") + 1), null);
  assert.equal(loaded.provider.provideDefinition(document(text), text.indexOf("%value", text.indexOf("#")) + 1), null);
  assert.equal(loaded.provider.provideDefinition(document(text), text.lastIndexOf("%value") + 1), null);
  loaded.deactivate();
  assert.equal(loaded.registrationDisposed, true);
});
