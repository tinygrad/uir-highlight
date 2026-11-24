// Generates syntaxes/uir.tmLanguage.json — run: node gen_grammar.js
const fs = require("fs");

// Colors from tinygrad/uop/render.py plus studentgrad ASSERT — kept in sync with extension.js.
const OP_COLORS = {
  load: "#ffc0c0", store: "#87CEEB", const: "#9e9e9e", reduce: "#FF5B5B", assert: "#cccccc",
  range: "#c8a0e0", barrier: "#ff8080", if: "#c8b0c0", special: "#c0c0ff",
  index: "#D8F9E4", stack: "#D8F9E4",
  wmma: "#efefc0", unshard: "#f6ccff", ins: "#eec4ff",
  // GroupOp.Movement
  reshape: "#D8F9E4", expand: "#D8F9E4", permute: "#D8F9E4", pad: "#D8F9E4", shrink: "#D8F9E4", flip: "#D8F9E4",
  // GroupOp.ALU
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

// Every tinygrad op, plus studentgrad ASSERT, lowercase as rendered in .uir.
const ALL_OPS = [
  "assert", "special", "buffer", "extern", "alloc", "noop", "rewrite_error", "param", "call", "program", "linear", "source", "binary",
  "sink", "after", "group", "stack", "getaddr", "index", "shrink", "load", "store", "wmma",
  "cast", "bitcast", "exp2", "log2", "sin", "sqrt", "recip", "neg", "trunc",
  "add", "mul", "shl", "shr", "truncdiv", "max", "truncmod", "cmplt", "cmpne", "cmpeq", "xor", "or", "and",
  "threefry", "sub", "fdiv", "pow", "div", "mod", "where", "mulacc",
  "barrier", "range", "if", "end", "endif", "backedge", "const", "custom", "customi", "ins",
  "contiguous_backward", "detach", "stage", "copy", "native", "mselect", "mstack", "custom_function",
  "reshape", "permute", "expand", "pad", "flip", "unshard", "reduce", "allreduce", "pyliteral",
];

// longest-first so e.g. `custom_function` wins over `custom`
const opRules = [...ALL_OPS].sort((a, b) => b.length - a.length).map((op) => ({
  match: `\\b${op}\\b`,
  name: `keyword.other.op.uir.${op.replace(/_/g, "-")}`,
}));

const grammar = {
  $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  name: "UIR",
  scopeName: "source.uir",
  patterns: [
    { include: "#expect" },
    { include: "#comment" },
    { include: "#string" },
    { include: "#ssa-def" },
    { include: "#ssa-ref" },
    { include: "#key" },
    { include: "#op" },
    { include: "#addrspace" },
    { include: "#axis-type" },
    { include: "#dtype" },
    { include: "#range-id" },
    { include: "#boolean" },
    { include: "#hex-float" },
    { include: "#hex-integer" },
    { include: "#float" },
    { include: "#number" },
    { include: "#punctuation" },
  ],
  repository: {
    expect: { match: "^#\\s*EXPECT\\b.*$", name: "comment.line.expect.uir" },
    comment: { match: "[#;].*$", name: "comment.line.uir" },
    string: { patterns: [
      { match: String.raw`b?"(?:\\[^\r\n]|[^"\\\r\n])*(?:"|$)`, name: "string.quoted.double.uir" },
      { match: String.raw`b?'(?:\\[^\r\n]|[^'\\\r\n])*(?:'|$)`, name: "string.quoted.single.uir" },
    ] },
    op: { patterns: opRules },
    "ssa-def": {
      match: "^[ \\t]*(%\\w+)\\s*(=)",
      captures: {
        1: { name: "variable.other.ssa.uir" },
        2: { name: "keyword.operator.assignment.uir" },
      },
    },
    "ssa-ref": { match: "%\\w+", name: "variable.other.ssa.uir" },
    addrspace: {
      match: "\\b(GLOBAL|ALU)\\b",
      name: "constant.other.addrspace.uir",
    },
    "axis-type": {
      match: "\\b(DEVICE|GLOBAL|LOCAL|WARP|WEAK|LOOP|UPCAST)\\b",
      name: "constant.other.axistype.uir",
    },
    dtype: {
      match: "\\b(void|int|float|weakint|weakfloat|bool|bf16|f16|f32|f64|i8|i16|i32|i64|u8|u16|u32|u64)\\b",
      name: "support.type.dtype.uir",
    },
    "range-id": { match: "\\br\\d+(?:_\\d+)*\\b", name: "constant.numeric.range-id.uir" },
    "hex-float": {
      match: "-?\\b0x[0-9a-fA-F.]+p[+-]?\\d+\\b",
      name: "constant.numeric.hex-float.uir",
    },
    "hex-integer": {
      match: "-?\\b0x[0-9a-fA-F]+\\b",
      name: "constant.numeric.hex-integer.uir",
    },
    float: {
      match: "-?\\b(?:(?:0|[1-9][0-9]*)(?:\\.[0-9]+(?:e[+-]?[0-9]+)?|e[+-]?[0-9]+)|inf|nan)\\b",
      name: "constant.numeric.float.uir",
    },
    boolean: { match: "\\b(True|False|true|false)\\b", name: "constant.language.boolean.uir" },
    number: { match: "-?\\b\\d+\\b", name: "constant.numeric.uir" },
    key: { match: "\\b[A-Za-z_][A-Za-z0-9_]*(?==)", name: "variable.parameter.key.uir" },
    punctuation: { patterns: [
      { match: "[{}]", name: "punctuation.section.block.uir" },
      { match: "[\\[\\]]", name: "punctuation.section.brackets.uir" },
      { match: "[()]", name: "punctuation.section.parens.uir" },
      { match: "[:,]", name: "punctuation.separator.uir" },
      { match: "=", name: "keyword.operator.assignment.uir" },
    ] },
  },
};

fs.writeFileSync(__dirname + "/syntaxes/uir.tmLanguage.json", JSON.stringify(grammar, null, 2) + "\n");
console.log(`wrote syntaxes/uir.tmLanguage.json (${opRules.length} op rules)`);
