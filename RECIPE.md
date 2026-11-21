# Modulor

A Bauhaus and Le Corbusier (*Le Modulor* & *Polychromie Architecturale*) light command wall for Herdr App. The 27-inch layout (`modulor-27`) tiles every running agent pane side by side between a 3-section left control column (`Review Queue`, `Quota & Token Load`, `Spaces`) and a 2-section right live inspector (`Inspector`, `Workspace Git`), anchored by a compact bottom telemetry strip; switching to the 13-inch layout (`modulor-13`) keeps a single scrollable focus strip over the active terminal.

![Modulor](preview.png)

## What you see

Built around a zero-radius (`radius: 0`), `1px` architectural grid (`#CFC8B8` dividers) on warm light mineral surfaces from `themes/corbusier-light.json`:

| Surface / Accent | Hex | Role |
| --- | --- | --- |
| `background` / `surface` / `popover` | `#FAF8F4` | Active pane canvas, card interiors, node chips |
| `chrome` | `#F1EDE4` | Left sidebar, right inspector, strip, status bar |
| `canvas` | `#E8E2D5` | Tiled grid gutter behind panes |
| `raised` / `selected` | `#E5DFD2` / `#DDD6C6` | Section headers, focused panel-load rows |
| `border` / `input` | `#CFC8B8` / `#B2AA99` | Grid rules and outer popup frames |
| `foreground` / `muted` / `dim` | `#191816` / `#4F4B44` / `#6B655B` | Carbon black text and inverted focused bars |
| `blocked` (Vermilion) | `#B83221` | Needs attention (`REV`, `REVIEW`), `RUN`, `LESSON` |
| `done` (Ultramarine) | `#1B4F79` | Unread finished (`NEW`, `UNREAD`), `READ`, `DOC` |
| `working` (Ochre) | `#8A5A0A` | Active turn (`WRK`, `WORK`), `EDIT`, `GRAPH` |

### `modulor-27` (Desktop Command Wall)

- Root `row`, `titlebar: "none"`, `traffic_lights: [14, 11]`, `font: "Geist Mono"` (`13.5px`, `terminal_line_height: 1.14`, `terminal_padding: [10, 12]`), `ui_font: "Geist"`.
- **Left sidebar (`272px`, min `68`, max `440`, `chrome`)**:
  1. `sidebar-queue` (`weight: 3`, min `150`): `36px` top `MODULOR` header (macOS inset `78px`, `13"` layout switcher pill, collapse button) + `26px` `Review Queue` header + priority agent ledger. Collapses to a `78px` macOS (`54px` Linux) numbered status rail (`#` + badge).
  2. `sidebar-quota` (`weight: 5`, min `210`): `26px` `Quota & Token Load` bar + multi-account rate-limit blocks (`GEMINI 5H`, `GEMINI WK`, `3P 5H`, `3P WK` with reset countdowns) + `Panel Load` comparing every pane's context token bar (`#1 tid`, model, `CTX`, `%`) and `Σ CTX · OUT`.
  3. `sidebar-spaces` (`96px`, min `72`): `Spaces` header (`Spaces · N SSH` when remotes connect, `+` new space trigger) + scrollable workspace rows with branch and remote machine pills.
- **Center work column (`resizable: false`)**:
  1. `tabs` (`36px`, `window_drag: true`): scrollable board tabs (`2px` `#191816` top rule on active), conditional `SHOW ALL PANELS` red button when zoomed, conditional `TILE ALL (N)` blue button when background tabs hold hidden agents, `+ Panel` direct split button, `+ Tab` button (right-click opens `new-menu`), and independent `Quota`, `Memory`, `Git` toggle pills.
  2. `work-body` (`row`): `main` (`6px` `canvas` padding, `6px` `gap`, `0px` pane `radius`, `lone: true`, `1px` `border`, `2px` `#191816` focus border, `28px` always-visible `modulor-pane` top header) + `panel` (`336px`, min `250`, max `540`, `chrome`) holding `deck-memory` (`weight: 6`, min `260`) over `deck-git` (`weight: 3`, min `160`).
  3. `status` (`28px`): `modulor-bar` showing active account tag, 4-cell remaining meters (`GEM 5H`, `WK`, `3P 5H`), optional `MEM` pill when right panel is hidden, `REVIEW N` / `UNREAD N` buttons, `CTX · OUT` totals, and `LOCAL` / `SSH <MACHINE>` badge.

### `modulor-13` (Laptop / SSH Focus View)

- Root `column`, `font_size: 13`, `terminal_line_height: 1.12`, `terminal_padding: [8, 10]`.
- `strip` (`38px`): macOS traffic-light padding + horizontal agent chip strip (`#`, status mark, title, context token badge) + `+ Agent` (`+ agy`/`+ claude`), `SP` space switcher popup, `Memory` inspector popup (`360x500`), and `27"` layout switcher button.
- `viewport`: full-bleed `{ "agent": "focused" }` terminal.
- `status` (`26px`): compact `modulor-bar`.

## How it behaves

- **Status representation**:
  - `blocked`: Vermilion `#B83221` square badge (`REV` in queue/strip, `REVIEW` in pane header), pulses opacity (`0.62 -> 1`, `1600ms`) when unfocused, soft tint `#F5E6E3` row/header background.
  - `done`: Ultramarine `#1B4F79` badge (`NEW` in queue/strip, `UNREAD` in pane header), tint `#E6EEF5`.
  - `working`: Ochre `#8A5A0A` badge (`WRK` in queue, `WORK` in pane header, `6px` square in strip).
  - `idle`: `1px` bordered outlined badge (`IDL` in queue, `IDLE` in pane header).
  - Focused row/pane header inverts to Carbon Black `#191816` with `#FAF8F4` text; urgent unviewed agents increment the macOS Dock badge via `setBadge(...)`.
- **Sorting & cycling**: `Review Queue` sorts `blocked (4) > done (3) > working (2) > idle (1)`, calling `setAgentOrder(...)` so `agent.next` (`Cmd+]`) follows visual queue order. Clicking any queue row runs `agent.focus`.
- **Focused Inspector (`modulor-memory`)**:
  - Defaults to `FOCUSED` mode with a `GLOBAL` toggle (`cmd` overlay also supported with close icon).
  - Switching focus updates the `#191816` inspector banner, loaded skills/artifacts strip, `LIVE CALLS` (with pulsing `RUN` badge while a tool call has not yet received a completion step), `WORKING FILES` (`R`/`E`/`W` counts), a 2D vector `MEMORY GRAPH` (`PathBuilder.stroke` + `cx.window.paint_path`), `CONTEXTUAL DOCS` / `CONTEXTUAL MEMORY` matched by workspace keywords, and collapsible `WORKING SLOTS`.
  - Focusing a plain shell renders quick-jump chips for live agent panes and a `GLOBAL` switch button.
- **Smart Workspace Git (`modulor-git`)**: Polls `git --no-optional-locks` every `2s` on context change (else `8s`). Prefers `inferred_cwd` from `modulor.telemetry` (`TRACK` badge) so even agents launched from `$HOME` display the repository of files they are actively editing; falls back to `pane.cwd` -> `space.folder`. Uses `--untracked-files=no` when rooted at `$HOME`.

## Built from

- **Layouts**: `layouts/modulor-27.json` (+ `layouts/modulor-27.svg`) and `layouts/modulor-13.json` (+ `layouts/modulor-13.svg`).
- **Theme**: `themes/corbusier-light.json` (set `theme` / `appearance: "light"` in `settings.json`).
- **Keys (`keys.json`)**: `cmd-shift-m` (`layout.toggle:panel`), `cmd-shift-0` (`layout.switch:modulor-27`), `cmd-shift-9` (`layout.switch:modulor-13`).
- **Mods (all `mod.json` use `{ "place": "none" }`):**
  - `modulor-bar` (`main.js`, `probe.py`, `agy-statusline.sh`, `icons/*.svg`): executes `probe.py` locally and over `exec("python3", ["-c", src], { on: machine })` every `2200ms` (all machines every 4th tick), publishes `"modulor.telemetry"` via `setShared`, renders bottom status + quota popup overlay (`popup: "quota"`).
  - `modulor-pane` (`main.js`): receives `pane`; reads `"modulor.telemetry"`, renders 4-segment `miniMeter`, hover split-right/split-down/close buttons (`pane.split`, `pane.close`), zero hover zoom button.
  - `modulor-queue` (`main.js`): `props.section === "queue" | "spaces"`; uses `agents()`, `terminals()`, `spaces()`, `machines()`, `setAgentOrder()`, `setBadge()`, `layout.hide/show/resize`, `space.select`, `space.new`.
  - `modulor-quota` (`main.js`): renders multi-account buckets sorted with focused account first + `Panel Load` (`pane.focus`).
  - `modulor-strip` (`main.js`): `props.mode === "tabs" | "focus-strip"` and `props.popup === "spaces"`; uses `pane.split`, `tab.new`, `tab.select`, `tab.move`, `tab.rename`, `tab.close`, `terminal.park`, `terminal.keep`, `pane.zoom`, `layout.toggle/show/resize/switch`. Auto-detects active agent binary (`agy`, `claude`, `codex`, `gemini`, `opencode`, `pi`) for `+ Panel` / `+ Tab`.
  - `modulor-memory` (`main.js`): draws 2D graph edges using `PathBuilder` percentage coordinates inside `#mm-graph` (`on_size_change` width tracking) and `cx.window.paint_path`.
  - `modulor-git` (`main.js`): runs `git --no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false` (`rev-parse`, `symbolic-ref`, `rev-list`, `status --porcelain=v1 -z`, `diff HEAD --numstat -z`).
- **Icons (`mods/modulor-bar/icons/`)**: Eleven `16x16` stroke (`1.4px`, `currentColor`) SVGs (`branch.svg`, `chevron-down.svg`, `chevron-right.svg`, `close.svg`, `panel-right.svg`, `plus.svg`, `sidebar.svg`, `split-down.svg`, `split-right.svg`, `unzoom.svg`, `zoom.svg`).
- **Telemetry & Adapter Contract (`probe.py`)**:
  Outputs `{ ts, latest_email, active_emails, accounts, terminals, memory }`.
  - Reads `agy` sessions (`~/.gemini/antigravity-cli/presence/*.lock`, `log/cli-*.log`, `conversation_summaries.db`, `transcript.jsonl`) and optional `~/.cache/herdr-modulor/accounts.json` written by `agy-statusline.sh`.
  - Reads optional external SQLite memory DB when env `MODULOR_MEMORY_DB` points to a compatible database (`slots`, `memories`, `nodes`, `edges` opened read-only `?mode=ro`); otherwise scans up to 8 markdown doc/rule files (`AGENTS.md`, `CLAUDE.md`, `MEMORY.md`, `.cursorrules`, `RECIPE.md`, `README.md`) under each active project root into `ctx_memories` and `ctx_graph`.
  - Other CLIs (`claude`, `codex`, custom harnesses) only need an adapter block in `probe.py` filling `terminals[HC_TERMINAL_ID]` with `{ live_calls, working_files, active_skills, artifacts, inferred_cwd, work_dir, ctx_tokens, out_tokens, ctx_memories, ctx_graph }`.

## Watch out

- **Light-mode settings**: Pair `corbusier-light` with `"appearance": "light"` in `settings.json` (`minimum_contrast: 4.2` recommended for crisp `#FAF8F4` vs `#191816` contrast); using dark appearance overrides light chrome readability.
- **`mod.json` placement**: All 7 mods intentionally declare `"place": "none"` so switching away from Modulor (`Ctrl+Shift+L`) never leaves orphaned docks on other layouts.
- **Checking guard**: Keep `if (checking()) return;` before timers or `setBadge` calls in `init()` so `herdr-app check` passes cleanly without a window.
- **`transcript.jsonl` JSON-quoted args**: Tool-call string arguments in Antigravity transcripts are nested JSON strings (e.g. `"\"/path/to/file\""`); always unquote with `json.loads` (`unquote_arg` in `probe.py`) before resolving paths or git roots.
- **Home-directory git safety**: Never run `--untracked-files=normal` if the resolved repo root equals `home()` (hundreds of thousands of home files will stall status); `modulor-git` switches to `--untracked-files=no` whenever `root === home()`.
- **Large FTS tables**: If connecting `MODULOR_MEMORY_DB`, avoid trigram `MATCH` across `>100k` observation rows during 2.2s polling; filter by `kind IN ('memory','lesson','crystal')` directly (~10ms).
- **`paint_path` coordinates**: Percentage strings (`"45.00%"`) passed to `PathBuilder` resolve against the painted `div`'s own bounds when wrapped inside `.absolute().inset(0).size_full()`.

## Done when

- `for m in modulor-bar modulor-pane modulor-queue modulor-quota modulor-strip modulor-memory modulor-git; do herdr-app check ~/.config/herdr-app/mods/$m || exit 1; done` exits `0`.
- `python3 -m json.tool` succeeds on `layouts/modulor-27.json`, `layouts/modulor-13.json`, `themes/corbusier-light.json`, `keys.json`, and every `mods/*/mod.json`.
- `python3 mods/modulor-bar/probe.py | python3 -m json.tool` prints valid JSON (`ts`, `accounts`, `terminals`, `memory`) in `<1s` whether or not `MODULOR_MEMORY_DB` or `agy` is active.
- Switching layout (`herdr-app do layout.switch '{"name":"modulor-27"}'`) renders all 3 columns (`Review Queue` + `Quota & Token Load` + `Spaces`, tiled center grid, `Inspector` + `Workspace Git`) and `herdr-app status` returns `"errors": []`.
- Clicking a different pane updates the focused carbon header (`#191816`), `Inspector` (`LIVE CALLS`, `WORKING FILES`, `MEMORY GRAPH`), and `Workspace Git` repo (`TRACK`) within ~2s.
