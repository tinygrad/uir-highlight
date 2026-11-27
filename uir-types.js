// Lightweight studentgrad UIR parser and shape/dtype inference for editor hovers.
// Inference is best effort, not validation: a shape or dtype may be unknown.

const LEX_RE = /[#;][^\r\n]*|b?"(?:\\[^\r\n]|[^"\\\r\n])*(?:"|(?=\r?$))|b?'(?:\\[^\r\n]|[^'\\\r\n])*(?:'|(?=\r?$))|%\w+=?|\b[A-Za-z_]\w*=[^\s()[\]{},:#;"']+|[()[\]{},:=]|[^\s%()[\]{},:=#;"']+/gm;

function lex(text) {
  const tokens = [];
  LEX_RE.lastIndex = 0;
  let match;
  while ((match = LEX_RE.exec(text))) {
    const value = match[0];
    if (/^(?:[#;]|b?["'])/.test(value)) continue;
    tokens.push({ value, start: match.index, end: match.index + value.length });
  }
  return tokens;
}

function isRef(token) {
  return token && token.value.startsWith("%");
}

class Parser {
  constructor(text) {
    this.tokens = lex(text);
    this.index = 0;
    this.references = [];
  }

  current() { return this.tokens[this.index]; }

  isDefinition(index = this.index) {
    const token = this.tokens[index];
    return isRef(token) && (token.value.endsWith("=") || this.tokens[index + 1]?.value === "=");
  }

  addReference(token, node, name = token.value) {
    const start = token.start;
    this.references.push({ start, end: start + name.length, name, node });
  }

  parse() {
    const environment = new Map();
    while (this.current()) {
      if (this.isDefinition()) this.parseBinding(environment);
      else this.index++;
    }
    this.references.sort((a, b) => a.start - b.start);
    return { references: this.references };
  }

  parseBinding(environment) {
    const token = this.current();
    const name = token.value.replace(/=$/, "");
    this.index++;
    if (this.current()?.value === "=") this.index++;
    const node = this.parseAtom(environment, true);
    environment.set(name, node);
    this.addReference(token, node, name);
    return node;
  }

  parseAtom(environment, allowBareOp = false) {
    const token = this.current();
    if (!token) return { kind: "unknown" };

    if (isRef(token)) {
      this.index++;
      if (token.value.endsWith("=")) return { kind: "unknown" };
      const node = environment.get(token.value) || { kind: "unknown" };
      this.addReference(token, node);
      return node;
    }

    if (token.value === "[") return this.parseStack(environment);
    if (token.value === "(") return this.parseParenthesized(environment);
    if (token.value === "{") return this.parseScope(environment);
    if (token.value === "," || token.value === ":") {
      this.index++;
      return this.parseAtom(environment, allowBareOp);
    }
    if (token.value === ")" || token.value === "]" || token.value === "}" || token.value === "=") {
      this.index++;
      return { kind: "unknown" };
    }

    this.index++;
    if (allowBareOp && /^[a-z_]\w*$/.test(token.value) && !isLiteral(token.value)) {
      return this.parseOperation(token.value, environment, null);
    }
    return literalNode(token.value);
  }

  parseStack(environment) {
    this.index++; // [
    const sources = [];
    while (this.current() && this.current().value !== "]") {
      if (this.current().value === ",") this.index++;
      else sources.push(this.parseAtom(environment));
    }
    if (this.current()?.value === "]") this.index++;
    return { kind: "stack", sources };
  }

  parseParenthesized(environment) {
    this.index++; // (
    const op = this.current();
    if (!op || op.value === ")") {
      if (op) this.index++;
      return { kind: "unknown" };
    }
    this.index++;
    return this.parseOperation(op.value, environment, ")");
  }

  parseOperation(op, environment, closer) {
    const sources = [];
    const attrs = Object.create(null);
    let attributesOnly = false;

    while (this.current()) {
      const token = this.current();
      if (token.value === closer || token.value === "}") break;
      if (!closer && this.isDefinition()) break;
      if (token.value === ",") {
        this.index++;
        continue;
      }
      if (token.value === ":") {
        attributesOnly = true;
        this.index++;
        continue;
      }
      const attribute = /^([A-Za-z_]\w*)=(.*)$/.exec(token.value);
      if (attribute) {
        attrs[attribute[1]] = attribute[2];
        this.index++;
        continue;
      }
      // Tinygrad's wire format puts positional metadata after ':'. It does not
      // affect studentgrad type inference, so skip it rather than treating it as a source.
      if (attributesOnly) {
        this.index++;
        continue;
      }
      sources.push(this.parseAtom(environment));
    }
    if (closer && this.current()?.value === closer) this.index++;
    return { kind: "op", op, sources, attrs };
  }

  parseScope(environment) {
    this.index++; // {
    const scoped = new Map(environment);
    let result = { kind: "unknown" };
    while (this.current() && this.current().value !== "}") {
      if (this.isDefinition()) result = this.parseBinding(scoped);
      else this.index++;
    }
    if (this.current()?.value === "}") this.index++;
    return { kind: "scope", result };
  }
}

function isLiteral(value) {
  return value === "true" || value === "false" || value === "inf" || value === "-inf" || value === "nan" ||
    /^-?(?:0x[0-9a-f]+|\d)/i.test(value);
}

function literalNode(value) {
  let dtype = null;
  if (value === "true" || value === "false") dtype = "bool";
  else if (/^-?0x[0-9a-f]+$/i.test(value) || /^-?\d+$/.test(value)) dtype = "i32";
  else if (["inf", "-inf", "nan"].includes(value) || /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) dtype = "f32";
  return { kind: "const", value, dtype };
}

function sourceType(node, index, cache, visiting) {
  return node?.sources[index] ? inferType(node.sources[index], cache, visiting) : null;
}

function normalizedDtype(value) {
  if (value === "int") return "i32";
  if (value === "float") return "f32";
  return value || null;
}

function constantNumber(node) {
  if (node?.kind === "op" && node.op === "after") return constantNumber(node.sources[0]);
  if (node?.kind !== "const") return null;
  if (!/^-?(?:0x[0-9a-f]+|\d+)$/i.test(node.value)) return null;
  const value = Number(node.value);
  return Number.isSafeInteger(value) ? value : null;
}

// Decode the scalar-or-stack shape representation used by studentgrad:
// [] means (), while a scalar 4 means (4,), and [2 3] means (2, 3).
function shapeValue(node) {
  if (node?.kind === "op" && node.op === "after") return shapeValue(node.sources[0]);
  if (node?.kind === "const") {
    const value = constantNumber(node);
    return value !== null && value >= 0 ? [value] : null;
  }
  if (node?.kind !== "stack") return null;
  const result = [];
  for (const source of node.sources) {
    const value = constantNumber(source);
    if (value === null || value < 0) return null;
    result.push(value);
  }
  return result;
}

function sameShape(types) {
  if (!types.length || types.some(type => !type?.shape)) return null;
  const first = types[0].shape;
  const matches = types.every(({ shape }) =>
    shape.length === first.length && shape.every((n, i) => n === first[i])
  );
  return matches ? first : null;
}

function inferType(node, cache = new WeakMap(), visiting = new Set()) {
  if (!node || node.kind === "unknown") return { shape: null, dtype: null };
  if (cache.has(node)) return cache.get(node);
  if (visiting.has(node)) return { shape: null, dtype: null };
  visiting.add(node);

  let result = { shape: null, dtype: null };
  if (node.kind === "const") {
    result = { shape: [], dtype: node.dtype };
  } else if (node.kind === "scope") {
    result = inferType(node.result, cache, visiting);
  } else if (node.kind === "stack") {
    const types = node.sources.map(source => inferType(source, cache, visiting));
    const elementShape = sameShape(types);
    result = types.length === 0 ? { shape: [], dtype: "void" } : {
      shape: elementShape ? [types.length, ...elementShape] : null,
      dtype: types[0].dtype,
    };
  } else if (node.kind === "op") {
    const { op, sources, attrs } = node;
    const first = sourceType(node, 0, cache, visiting);
    const second = sourceType(node, 1, cache, visiting);
    const third = sourceType(node, 2, cache, visiting);
    const dtype = () => {
      if (["param", "extern", "buffer", "alloc"].includes(op)) return normalizedDtype(attrs.dtype);
      if (["cast", "bitcast"].includes(op)) return normalizedDtype(attrs.dtype);
      if (["cmplt", "cmpne", "cmpeq"].includes(op)) return "bool";
      if (op === "where") return second?.dtype || null;
      if (op === "store") return "void";
      if (op === "gradient") return second?.dtype || null;
      if (op === "range") return first?.dtype || "i32";
      return first?.dtype || null;
    };

    let shape = sameShape([first, second, third].filter(Boolean));
    if (["call", "after", "end", "detach", "barrier"].includes(op)) shape = first?.shape || null;
    else if (op === "gradient") shape = second?.shape || null;
    else if (["param", "extern", "buffer", "alloc"].includes(op)) shape = shapeValue(sources[0]);
    else if (op === "index") shape = first?.shape ? first.shape.slice(Math.max(0, sources.length - 1)) : null;
    else if (op === "shrink" || op === "pad") shape = shapeValue(sources[2]);
    else if (op === "expand") {
      const leading = shapeValue(sources[1]);
      shape = leading && first?.shape ? [...leading, ...first.shape] : null;
    } else if (op === "reduce") {
      if (first?.shape) {
        const outer = Number(attrs.outer || 0);
        const pop = Number(attrs.pop || 0);
        const valid = Number.isInteger(outer) && Number.isInteger(pop) &&
          outer >= 0 && pop >= 0 && outer + pop <= first.shape.length;
        shape = valid ? [...first.shape.slice(0, outer), ...first.shape.slice(outer + pop)] : null;
      }
    } else if (op === "reshape") shape = shapeValue(sources[1]);
    else if (op === "permute") {
      const order = shapeValue(sources[1]);
      shape = order && first?.shape && order.every(i => i < first.shape.length) ? order.map(i => first.shape[i]) : null;
    } else if (op === "stage") {
      const extents = sources.slice(1).map(range =>
        range.kind === "op" && range.op === "range" ? constantNumber(range.sources[0]) : null
      );
      shape = first?.shape && extents.every(n => n !== null) ? [...extents, ...first.shape] : null;
    } else if (["range", "store", "const"].includes(op)) shape = [];
    result = { shape, dtype: dtype() };
  }

  visiting.delete(node);
  cache.set(node, result);
  return result;
}

function analyze(text) {
  const analysis = new Parser(text).parse();
  analysis.cache = new WeakMap();
  return analysis;
}

function referenceAt(analysis, offset) {
  // Editors can place the cursor immediately after the clicked character, so the
  // end boundary is included for both click and hover lookup.
  let low = 0;
  let high = analysis.references.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (analysis.references[middle].start <= offset) {
      candidate = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (candidate < 0) return null;
  const reference = analysis.references[candidate];
  return offset <= reference.end ? reference : null;
}

function typeOf(analysis, reference) {
  return inferType(reference.node, analysis.cache);
}

function formatShape(shape) {
  return shape ? `[${shape.join(" ")}]` : "unknown";
}

module.exports = { analyze, referenceAt, typeOf, formatShape };
