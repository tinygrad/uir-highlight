const vscode = require("vscode");
const { analyze, referenceAt, typeOf, formatShape } = require("./uir-types");

// Op colors from tinygrad/uop/render.py (uops_colors), with readability adjustments.
const OP_COLORS = {
  load: "#ffc0c0", store: "#87CEEB",
  // tinygrad uses #e0e0e0 for const, but that's indistinguishable from default text on
  // dark themes, so use a visible mid-gray instead
  // ASSERT explicitly matches Dark Modern's default foreground.
  const: "#9e9e9e", reduce: "#FF5B5B", assert: "#cccccc",
  range: "#c8a0e0", barrier: "#ff8080", if: "#c8b0c0", special: "#c0c0ff",
  index: "#D8F9E4", stack: "#D8F9E4",
  wmma: "#efefc0", unshard: "#f6ccff", ins: "#eec4ff",
  reshape: "#D8F9E4", expand: "#D8F9E4", permute: "#D8F9E4", pad: "#D8F9E4", shrink: "#D8F9E4", flip: "#D8F9E4",
  cast: "#ffffc0", exp2: "#ffffc0", log2: "#ffffc0", sin: "#ffffc0", sqrt: "#ffffc0", recip: "#ffffc0", neg: "#ffffc0", trunc: "#ffffc0",
  add: "#ffffc0", mul: "#ffffc0", truncdiv: "#ffffc0", max: "#ffffc0", truncmod: "#ffffc0", cmplt: "#ffffc0", cmpne: "#ffffc0",
  cmpeq: "#ffffc0", xor: "#ffffc0", shl: "#ffffc0", shr: "#ffffc0", or: "#ffffc0", and: "#ffffc0", sub: "#ffffc0",
  fdiv: "#ffffc0", pow: "#ffffc0", div: "#ffffc0", mod: "#ffffc0", where: "#ffffc0", mulacc: "#ffffc0",
  threefry: "#ffff80",
  buffer: "#B0BDFF", extern: "#adc3e8", getaddr: "#9DB1F0", copy: "#ff90c0", native: "#bf71b6", custom_function: "#bf71b6",
  call: "#00B7C8", param: "#14686F", source: "#c0c0c0", binary: "#404040",
  linear: "#7DF4FF", alloc: "#C07788",
  allreduce: "#ff40a0", mselect: "#d040a0", mstack: "#d040a0",
  // END keeps tinygrad's warm-gray hue, lightened from #524C46 for dark-theme readability.
  stage: "#FFC14D", rewrite_error: "#1a1b26", after: "#8A7866", end: "#746c64", backedge: "#464752",
};

// axis type colors from tinygrad/uop/ops.py (axis_colors), ANSI names mapped to hex
const AXIS_COLORS = {
  DEVICE: "#16C60C", GLOBAL: "#3B78FF", LOCAL: "#61D6D6", WARP: "#61D6D6",
  WEAK: "#E74856", LOOP: "#E74856", UPCAST: "#F9F1A5",
};

// Studentgrad address spaces: GLOBAL shares the existing axis color; ALU uses
// the arithmetic-op color.
const ADDRSPACE_COLORS = { GLOBAL: AXIS_COLORS.GLOBAL, ALU: "#ffffc0" };

// Consume comments, escaped strings, refs and keys before bare words. This keeps
// op/axis names inside those tokens from receiving decorations, while recognizing
// ops at any nesting depth (including reduce's op=... argument).
const TOKEN_RE = /[#;][^\r\n]*|b?"(?:\\[^\r\n]|[^"\\\r\n])*(?:"|(?=\r?$))|b?'(?:\\[^\r\n]|[^'\\\r\n])*(?:'|(?=\r?$))|%\w+|\b[A-Za-z_]\w*(?==)|\b[A-Za-z_]\w*\b/gm;
const REF_COLOR = "#a0a6b8";  // from .uir-ref in tinygrad/viz/index.html
const KEY_COLOR = "#888888";  // keep attribute names subordinate to opcodes

const decorationTypes = new Map(); // color -> TextEditorDecorationType
function deco(color) {
  if (!decorationTypes.has(color)) {
    decorationTypes.set(color, vscode.window.createTextEditorDecorationType({ color }));
  }
  return decorationTypes.get(color);
}

// color -> Range[]
function computeDecorations(doc) {
  const byColor = new Map();
  const text = doc.getText();
  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(text))) {
    const token = match[0];
    let color;
    if (token.startsWith("%")) {
      color = REF_COLOR;
    } else if (/^[A-Za-z_]\w*$/.test(token) && text[match.index + token.length] === "=") {
      color = KEY_COLOR;
    } else if (text[match.index + token.length] !== "=") {
      if (Object.prototype.hasOwnProperty.call(OP_COLORS, token)) color = OP_COLORS[token];
      else if (Object.prototype.hasOwnProperty.call(ADDRSPACE_COLORS, token)) color = ADDRSPACE_COLORS[token];
      else if (Object.prototype.hasOwnProperty.call(AXIS_COLORS, token)) color = AXIS_COLORS[token];
    }
    if (!color) continue;
    const range = new vscode.Range(doc.positionAt(match.index), doc.positionAt(match.index + token.length));
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(range);
  }
  return byColor;
}

function applyToEditor(editor) {
  if (!editor || editor.document.languageId !== "uir") return;
  const byColor = computeDecorations(editor.document);
  // clear stale colors, then set current ones
  for (const [, type] of decorationTypes) editor.setDecorations(type, []);
  for (const [color, ranges] of byColor) editor.setDecorations(deco(color), ranges);
}

const analysisCache = new WeakMap();
function analysisFor(document) {
  const cached = analysisCache.get(document);
  if (cached && cached.version === document.version) return cached.analysis;

  const analysis = analyze(document.getText());
  analysisCache.set(document, { version: document.version, analysis });
  return analysis;
}

function provideHover(document, position) {
  const analysis = analysisFor(document);
  const reference = referenceAt(analysis, document.offsetAt(position));
  if (!reference) return null;
  const { shape, dtype } = typeOf(analysis, reference);
  if (!shape && !dtype) return null;

  const contents = new vscode.MarkdownString();
  contents.appendText(`${dtype || "unknown"} ${formatShape(shape)}`);
  const range = new vscode.Range(
    document.positionAt(reference.start),
    document.positionAt(reference.end),
  );
  return new vscode.Hover(contents, range);
}

function provideDefinition(document, position) {
  const text = document.getText();
  const offset = document.offsetAt(position);
  let ref;
  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(text))) {
    if (match[0].startsWith("%") && match.index <= offset && offset < match.index + match[0].length) {
      ref = match[0];
      break;
    }
  }
  if (!ref) return null;

  const definitions = [];
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text))) {
    if (match[0] !== ref || !/^\s*=/.test(text.slice(match.index + ref.length))) continue;
    const range = new vscode.Range(
      document.positionAt(match.index),
      document.positionAt(match.index + ref.length),
    );
    definitions.push(new vscode.Location(document.uri, range));
  }
  // Multiple locations support shadowed names: VS Code shows the definition picker.
  return definitions.length ? definitions : null;
}

function showHoverOnClick({ textEditor, selections, kind }) {
  if (kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
  if (selections.length !== 1 || !selections[0].isEmpty) return;

  const { document } = textEditor;
  if (document.languageId !== "uir") return;
  const reference = referenceAt(analysisFor(document), document.offsetAt(selections[0].active));
  if (reference) void vscode.commands.executeCommand("editor.action.showHover");
}

let timer;
let definitionRegistration;
let hoverRegistration;
let selectionRegistration;
function refreshAll() {
  for (const editor of vscode.window.visibleTextEditors) applyToEditor(editor);
}
function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(refreshAll, 100);
}

function activate() {
  refreshAll();
  definitionRegistration = vscode.languages.registerDefinitionProvider("uir", { provideDefinition });
  hoverRegistration = vscode.languages.registerHoverProvider("uir", { provideHover });
  selectionRegistration = vscode.window.onDidChangeTextEditorSelection(showHoverOnClick);
  vscode.window.onDidChangeActiveTextEditor(applyToEditor);
  vscode.window.onDidChangeVisibleTextEditors(refreshAll);
  vscode.workspace.onDidChangeTextDocument(scheduleRefresh);
}

function deactivate() {
  definitionRegistration?.dispose();
  hoverRegistration?.dispose();
  selectionRegistration?.dispose();
  for (const [, type] of decorationTypes) type.dispose();
}

module.exports = { activate, deactivate };
