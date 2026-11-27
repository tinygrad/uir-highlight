const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8");

function loadHover() {
  let provider;
  let selectionHandler;
  const commands = [];
  const vscode = {
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    Location: class { constructor(uri, range) { this.uri = uri; this.range = range; } },
    MarkdownString: class {
      appendText(value) {
        this.value = value;
      }
    },
    Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } },
    TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2 },
    window: {
      visibleTextEditors: [],
      createTextEditorDecorationType: () => ({ dispose() {} }),
      onDidChangeActiveTextEditor() {},
      onDidChangeVisibleTextEditors() {},
      onDidChangeTextEditorSelection(handler) {
        selectionHandler = handler;
        return { dispose() {} };
      },
    },
    workspace: { onDidChangeTextDocument() {} },
    languages: {
      registerDefinitionProvider() { return { dispose() {} }; },
      registerHoverProvider(selector, value) {
        assert.equal(selector, "uir");
        provider = value;
        return { dispose() {} };
      },
    },
    commands: {
      async executeCommand(command) { commands.push(command); },
    },
  };
  const context = { module: { exports: {} }, require: name => {
    if (name === "vscode") return vscode;
    assert.equal(name, "./uir-types");
    return require(path.join(__dirname, "../uir-types.js"));
  }, setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  context.module.exports.activate();
  return { provider, selectionHandler, commands, deactivate: context.module.exports.deactivate };
}

function document(text) {
  return {
    languageId: "uir",
    getText: () => text,
    offsetAt: position => position,
    positionAt: offset => offset,
  };
}

function hoverAt(provider, text, offset) {
  const hover = provider.provideHover(document(text), offset);
  return hover && { value: hover.contents.value, start: hover.range.start, end: hover.range.end };
}

test("hover reports inferred shapes and dtypes for studentgrad operations", () => {
  const { provider, deactivate } = loadHover();
  const text = `%matrix = param [2 3] slot=0 dtype=f32 addrspace=GLOBAL
%loaded = load %matrix
%reshaped = reshape %loaded [3 2]
%expanded = expand %loaded [4]
%reduced = reduce %expanded op=add pop=1 outer=1
%permuted = permute %loaded [1 0]
%axis = range 4 slot=0
%staged = stage %loaded %axis
%zero = 0
%item = index %reshaped %zero %zero
%flag = cmplt %item 0.0
%chosen = where %flag %item 1.0
%cast = cast %chosen dtype=i32
%empty = []
%void = store %matrix %loaded
%t = assert %cast 0`;
  const expected = [
    ["%matrix", "f32 [2 3]"],
    ["%loaded", "f32 [2 3]"],
    ["%reshaped", "f32 [3 2]"],
    ["%expanded", "f32 [4 2 3]"],
    ["%reduced", "f32 [4 3]"],
    ["%permuted", "f32 [3 2]"],
    ["%axis", "i32 []"],
    ["%staged", "f32 [4 2 3]"],
    ["%zero", "i32 []"],
    ["%item", "f32 []"],
    ["%flag", "bool []"],
    ["%chosen", "f32 []"],
    ["%cast", "i32 []"],
    ["%empty", "void []"],
    ["%void", "void []"],
    ["%t", "i32 []"],
  ];
  for (const [name, value] of expected) {
    const start = text.indexOf(`${name} =`);
    const hover = hoverAt(provider, text, start + 1);
    assert.deepEqual(hover, { value, start, end: start + name.length }, name);
  }
  deactivate();
});

test("uses and clicked end boundaries show the definition's type", () => {
  const { provider, deactivate } = loadHover();
  const text = `%p = param [] slot=0 dtype=i32 addrspace=ALU\n%sum = add %p %p`;
  const use = text.lastIndexOf("%p");
  const expected = "i32 []";
  assert.deepEqual(hoverAt(provider, text, use + 1), { value: expected, start: use, end: use + 2 });
  assert.deepEqual(hoverAt(provider, text, use + 2), { value: expected, start: use, end: use + 2 });
  deactivate();
});

test("scoped references use the visible shadowing definition", () => {
  const { provider, deactivate } = loadHover();
  const text = `%value = [1 2]
%block = {
  %value = [3 4 5]
  %result = index %value 0
}
%result = index %value 0`;
  const innerUse = text.indexOf("%value", text.indexOf("%result = index"));
  const outerUse = text.lastIndexOf("%value");
  assert.equal(hoverAt(provider, text, innerUse + 1).value, "i32 [3]");
  assert.equal(hoverAt(provider, text, outerUse + 1).value, "i32 [2]");
  deactivate();
});

test("clicking a reference opens its hover; clicking elsewhere or using the keyboard does not", () => {
  const { provider, selectionHandler, commands, deactivate } = loadHover();
  const text = `%p = param [] slot=0 dtype=i32 addrspace=ALU\n%sum = add %p 1`;
  const editor = { document: document(text) };
  const use = text.lastIndexOf("%p");
  const click = offset => selectionHandler({
    textEditor: editor, kind: 2, selections: [{ isEmpty: true, active: offset }],
  });
  click(use + 2);
  assert.deepEqual(commands, ["editor.action.showHover"]);
  click(text.indexOf("param"));
  assert.deepEqual(commands, ["editor.action.showHover"]);
  selectionHandler({ textEditor: editor, kind: 1, selections: [{ isEmpty: true, active: use + 1 }] });
  assert.deepEqual(commands, ["editor.action.showHover"]);
  click(text.indexOf("%p") + 1);
  assert.deepEqual(commands, ["editor.action.showHover", "editor.action.showHover"]);
  assert.equal(hoverAt(provider, text, text.indexOf("param")), null);
  deactivate();
});

test("comments and unknown references have no type hover", () => {
  const { provider, deactivate } = loadHover();
  const text = `%a = 1# %p = param [] dtype=i32\n%x = add %missing 1\n"%p"`;
  assert.equal(hoverAt(provider, text, text.indexOf("%p") + 1), null);
  assert.equal(hoverAt(provider, text, text.indexOf("%missing") + 1), null);
  assert.equal(hoverAt(provider, text, text.lastIndexOf("%p") + 1), null);
  deactivate();
});
