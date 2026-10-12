# tinygrad UIR Highlight

Syntax highlighting for tinygrad UIR files (`.uir`) — the SSA wire format printed by
`render_uir` / `UOp.render_uir()`.

Ops are colored with the **exact same colors tinygrad uses** (from
`uops_colors` in `tinygrad/uop/render.py`), applied via editor decorations so they
show up identically in any color theme, including nested inline ops such as
`(load (index (after %alloced, %5), 2))`:

| op | color |
|---|---|
| `const` | `#9e9e9e` (tinygrad uses `#e0e0e0`, which is invisible against default text on dark themes) |
| `load` | `#ffc0c0` |
| `store` | `#87CEEB` |
| `reduce` | `#FF5B5B` |
| `range` | `#c8a0e0` |
| `index` | `#CEF9B7` |
| `param` | `#14686F` |
| `call` | `#00B7C8` |
| `stage` | `#FFC14D` |
| ALU ops (`add`, `mul`, `sub`, ...) | `#ffffc0` |
| movement ops (`reshape`, `expand`, ...) | `#D8F9E4` |
| ... | see `extension.js` |

Axis types (`WEAK`, `GLOBAL`, `LOCAL`, ...) are colored per tinygrad's `axis_colors`
(ANSI names approximated in hex, since terminals vary).

The TextMate grammar additionally highlights structure in any theme: SSA ids and
refs (`%12`, `%two` — defs and uses share one color, like tinygrad's own output),
comments (`#` or `;`, with `# EXPECT:` lines as a distinct comment scope), numbers,
hex floats, dtypes (`f32`, `u8`, ...), range ids (`r1_2`), `key=value` args, and
strings. Each op also gets its own scope (`keyword.other.op.uir.<op>`) if you'd
rather theme them yourself.

## Install

Copy/symlink this folder into `~/.vscode/extensions/uir-highlight-0.2.2`, or:

```sh
npm i -g @vscode/vsce
vsce package
code --install-extension uir-highlight-0.2.2.vsix
```

Or just open the folder in VSCode and press F5 to try it in an Extension Development Host.

## Notes

- A few tinygrad colors are intentionally dark (`end` `#524C46`, `after` `#8A7866`,
  `binary` `#404040`, ...) — that's exactly what tinygrad's terminal output uses too.
- `sink`, `cast`, `bitcast`, and a few other ops have no color in tinygrad, so they
  fall back to your theme's keyword color.
- To regenerate the grammar after adding ops: `node gen_grammar.js`.
- Run highlighting regression tests: `npm test`.
