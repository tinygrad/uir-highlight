# tinygrad UIR Highlight

Syntax highlighting for tinygrad and studentgrad UIR files (`.uir`), including the
SSA wire format printed by `render_uir` / `UOp.render_uir()`.

Ops use **tinygrad's palette** (from `uops_colors` in `tinygrad/uop/render.py`),
with readability adjustments for `const` and `end`, plus studentgrad's `assert`.
Colors are applied via editor decorations so they
show up identically in any color theme, including nested inline ops such as
`(load (index (after %alloced, %5), 2))`:

| op | color |
|---|---|
| `const` | `#9e9e9e` (tinygrad uses `#e0e0e0`, which is invisible against default text on dark themes) |
| `load` | `#ffc0c0` |
| `store` | `#87CEEB` |
| `reduce` | `#FF5B5B` |
| `assert` (studentgrad) | `#cccccc` (explicit Dark Modern default foreground) |
| `range` | `#c8a0e0` |
| `end` | `#746c64` (tinygrad's warm gray `#524C46`, slightly lightened for dark themes) |
| `extern` | `#adc3e8` |
| `param` | `#14686F` |
| `call` | `#00B7C8` |
| `native` | `#bf71b6` |
| `stage` | `#FFC14D` |
| ALU ops (including `cast`) | `#ffffc0` |
| `stack`, `index`, `reshape`, `expand`, `permute`, `pad`, `shrink`, `flip` | `#D8F9E4` |
| ... | see `extension.js` |

Axis types (`WEAK`, `GLOBAL`, `LOCAL`, ...) are colored per tinygrad's `axis_colors`
(ANSI names approximated in hex, since terminals vary).

The TextMate grammar additionally highlights structure in any theme: SSA ids and
refs (`%12`, `%two` — defs and uses share `#a0a6b8` via decorations, like tinygrad's own output),
comments (`#` or `;`, with `# EXPECT:` lines as a distinct comment scope), numbers,
hex floats, dtypes (`f32`, `u8`, ...), range ids (`r1_2`), `key=value` args, and
strings. Studentgrad syntax (from `src/uir.py` and `src/spec.py`) is supported too:

- Nested lexical scopes (`%block = { ... }`), indented assignments, and multiline expressions.
- Stack/shape literals (`[]`, `[2 3]`, `[%x %y]`) and optional commas.
- Types `void`, `bool`, `i32`, `f32`, and aliases `int` / `float`.
- `addrspace=GLOBAL` / `addrspace=ALU`, bounds (`min=-4 max=4`), and reduction attributes (`op=add pop=1`).
- Booleans, signed hex integers, decimal/scientific floats, `inf`, and `nan`.

The comment shortcut inserts `#`; legacy `;` comments remain highlighted. Braces
support auto-closing, surrounding, and folding. `ALU` uses the arithmetic-op color.
Attribute names (`slot`, `dtype`, `op`, `pop`, etc.) are decorated in muted gray
`#888888`; the `=` and values keep their existing highlighting.

Each op also gets its own scope (`keyword.other.op.uir.<op>`) if you'd
rather theme them yourself.

## Type hover

Hover over or click an SSA reference to see its dtype and shape: `f32 [1 3 4]`,
`i32 [3]`, or `bool []` for a scalar. The type comes from the definition visible
at that reference.

## Definition navigation

Right-click an SSA reference such as `%22` and choose **Go to Definition** (or press
**F12**) to jump to its `%22 = ...` assignment. Definitions inside comments and
strings are ignored. If a name is shadowed in nested scopes, VS Code offers all
matching assignments in its definition picker.

## Install

Copy/symlink this folder into `~/.vscode/extensions/uir-highlight-0.2.7`, or:

```sh
npm i -g @vscode/vsce
vsce package
code --install-extension uir-highlight-0.2.7.vsix
```

Or just open the folder in VSCode and press F5 to try it in an Extension Development Host.

## Notes

- `end` stays close to its original warm gray with a modest lift to `#746c64`.
  Contrast on Dark Modern's `#1F1F1F` background is 3.2:1 (up from 1.95:1),
  intentionally subdued rather than meeting the 4.5:1 normal-text accessibility target.
- Other dark tinygrad colors remain unchanged (`after` `#8A7866`, `binary` `#404040`, ...).
- `sink`, `bitcast`, and a few other ops have no color in tinygrad, so they
  fall back to your theme's keyword color.
- To regenerate the grammar after adding ops: `node gen_grammar.js`.
- Run highlighting regression tests (including real TextMate tokenization): `npm ci && npm test`.
