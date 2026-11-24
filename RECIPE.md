# Modulor

A Bauhaus and Le Corbusier (*Le Modulor* & *Polychromie Architecturale*) light multi-agent command wall for Herdr App. The 27-inch layout (`modulor-27`) tiles 3–6+ parallel coding agents side by side between a 3-section left control column (`Review Queue`, `Quota & Token Load`, `Spaces`) and a 3-section right live inspector (`Inspector`, `Swarm & Subagents`, `Workspace Git`), anchored by a compact bottom telemetry bar and backed by on-demand `Blueprints` (`Quad 2×2` default), `Planche` command desk (`WALL` · `DOCS` · `PORTS`), `Cost` 7-day ledger, and `Log Watch`. Switching to `modulor-13` keeps a single scrollable focus strip over the active terminal with dialog access to Queue, Memory, Quota, Planche, and Blueprints.

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
| `blocked` (Vermilion) | `#B83221` | Needs attention (`REV`, `REVIEW`), `RUN`, `CONFLICT`, `LESSON` |
| `done` (Ultramarine) | `#1B4F79` | Unread finished (`NEW`, `UNREAD`), `READ`, `DOC` |
| `working` (Ochre) | `#8A5A0A` | Active turn (`WRK`, `WORK`), `EDIT`, `GRAPH` |

### `modulor-27` (Desktop Multi-Agent Command Wall)

- Root `row`, `titlebar: "none"`, `traffic_lights: [14, 11]`, `font: "Geist Mono"` (`13.5px`, `terminal_line_height: 1.14`, `terminal_padding: [10, 12]`), `ui_font: "Geist"`.
- **Left sidebar (`272px`, min `68`, max `440`, `chrome`)**:
  1. `sidebar-queue` (`weight: 3`, min `150`): `36px` top `MODULOR` header (`13"` layout switcher + collapse button) + `26px` `Review Queue` header + priority agent ledger (`[work_dir]`, harness tag, `!CNF` conflict mark). Collapses to a `78px` macOS (`54px` Linux) numbered status rail.
  2. `sidebar-quota` (`weight: 5`, min `210`): `26px` `Quota & Token Load` bar + multi-account buckets (`GEMINI 5H`, `GEMINI WK`, `3P 5H`, `3P WK` with reset countdown, linear-regression burn rate `-%/h · 0% in …` / `>reset`, and 16-bar sparklines) + `Panel Load` per-pane context bars.
  3. `sidebar-spaces` (`96px`, min `72`): `Spaces` header (`Spaces · N SSH` when remotes connect, `+` new space trigger) + scrollable workspace rows with branch and machine badges.
- **Center work column (`resizable: false`)**:
  1. `tabs` (`36px`, `window_drag: true`): scrollable board tabs (`2px` `#191816` top rule on active), conditional `SHOW ALL PANELS` unzoom guard, conditional `TILE ALL (N)` recovery button, conditional `Compose <Board>` button on blank single-shell tabs, `Planche`, `Blueprints`, `+ <DefaultBoard>` (`+ Quad`), `+ Panel`, `+ Tab` (right-click `new-menu`), and independent `Quota`, `Memory`, `Swarm`, `Git` toggles.
  2. `work-body` (`row`): `main` (`6px` `canvas` padding, `6px` `gap`, `0px` pane `radius`, `lone: true`, `1px` `border`, `2px` `#191816` focus border, `28px` always-visible `modulor-pane` header showing pane `#`, status/mod badge, `CONFLICT`, title, `[work_dir]` project chip, `MEM n` pill, harness/model, `miniMeter` + `CTX/OUT`, and hover split/close buttons) + `panel` (`336px`, min `250`, max `540`, `chrome`) holding:
     - `deck-memory` (`weight: 6`, min `210`): `modulor-memory` (`FOCUSED`/`GLOBAL`, skills, clickable `artifact_items`, `#ctx_keywords`, `LIVE CALLS`, clickable `WORKING FILES`, 2D `MEMORY GRAPH`, `CONTEXTUAL DOCS`/`MEMORY`, collapsible `WORKING SLOTS`).
     - `deck-swarm` (`weight: 2`, min `108`): `modulor-swarm` tree combining transcript `invoke_subagent`/`swarm` nodes with live Herdr child terminals.
     - `deck-git` (`weight: 3`, min `140`): `modulor-git` tracking the active agent's inferred repo.
  3. `status` (`28px`): `modulor-bar` showing active account tag, 4-cell quota meters, optional `MEM` pill when right panel is hidden, `REVIEW N` / `UNREAD N` buttons, `CTX · OUT` totals, `≈$X.XX` cost ledger button, `LOG` watcher toggle, and `LOCAL`/`SSH` badge.

### `modulor-13` (Laptop / SSH Focus View)

- Root `column`, `font_size: 13`, `terminal_line_height: 1.12`, `terminal_padding: [8, 10]`.
- `strip` (`38px`): macOS traffic-light padding + horizontal agent chip strip + `+ <Agent>`, `Planche`, `Blueprints`, `SP` spaces popup, `Memory` popup, and `27"` layout switcher.
- `viewport`: full-bleed `{ "agent": "focused" }` terminal.
- `status` (`26px`): compact `modulor-bar` with left `QUEUE` dialog trigger, quota cells, `MEM` pill, `≈$X.XX`, and `LOG`.

## How it behaves

- **Status representation**: `blocked` (`#B83221` Vermilion `REV`/`REVIEW`, pulsing opacity `0.62 -> 1` when unfocused, `#F5E6E3` tint), `done` (`#1B4F79` Ultramarine `NEW`/`UNREAD`, `#E6EEF5` tint), `working` (`#8A5A0A` Ochre `WRK`/`WORK`), `idle` (`1px` bordered `IDL`/`IDLE`). Focused rows and headers invert to `#191816` / `#FAF8F4`.
- **Sorting & cycling**: `Review Queue` sorts `blocked (4) > done (3) > working (2) > idle (1)` and calls `setAgentOrder(...)` so `agent.next` (`Cmd+]`) matches the visual queue. `modulor-bar.next-review` (`Cmd+Alt+R`) jumps directly between `blocked`/`done` agents.
- **Multi-agent Blueprints & Worktree Isolation (`modulor-blueprint`)**:
  - Presets: `quad-4` (2×2 4 agents), `quad-3p1` (3 agents + `modulor-planche`), `triptych-3` (3 balanced columns), `unite-1p2` (58:42 Lead + 2 workers), `hex-6` (3×2 6 agents), plus user-saved custom boards in `shared("modulor.blueprints")`.
  - Allows per-slot harness selection (`knownAgents()` + `shell` + `modulor-planche`/`changes`/`modulor-log`), local git repo dealing (`Deal 1..N`), and optional Git Worktree isolation (`~/.herdr/worktrees/<repo>-slotN`). Spawning executes asynchronously inside `modulor-bar` (`spawner.js`) via `tab.new`, `pane.focus`, `terminal.open`, `pane.split`, `pane.resize`, and `pane.rename` so closing the Blueprints dialog never cancels splits.
- **Planche Command Desk (`modulor-planche`)**:
  - `WALL`: 2-column grid of all running agents, conflict alert banner, `[Focus]`, `[Docs →]`, `[+ Worktree]`, and idle repo quick-launch.
  - `DOCS`: reads `.md` artifacts and project docs (`HANDOFF.md`, `PLAN.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`), stages `.png`/`.jpg`/`.webp` artifacts into `~/.config/herdr-app/.planche-thumbs/` for native `image()`, and renders `- [ ]` checklist items with `[Spawn ↗]` (`tab.new { folder, argv, task }`).
  - `PORTS`: polls `lsof -nP -iTCP -sTCP:LISTEN` (`1024–65535`) only while `PORTS` is active.
- **Alerts & Window Title (`modulor-bar` + `alerts.js`)**: Fires non-duplicating `notify`/`playSound` on quota `≤35%`/`≤15%` crossings, quota window refills, context `≥80%`/`≥90%`, and stale local probe (`>60s`), updating `setWindowTitle(...)` only when the summary string changes.
- **Click-to-open Artifacts & Files (`modulor-memory`)**: Local clicks execute `open` (`open -R` on `Cmd+Click`); remote machine paths copy to clipboard and toast.
- **Incremental Cost Ledger (`modulor-cost`) & Log Watch (`modulor-log`)**: `probe.py` maintains byte-offset incremental token totals in `~/.cache/herdr-modulor/usage-ledger.json` and `/1M` rates in `prices.json`. `modulor-log` opens as a persistent `window` overlay (`key: "modulor-log", keep: true`) using `pickFolder`, `watchFolder`, and Python tailing (`160` lines) with error notifications.

## Built from

- **Layouts**: `layouts/modulor-27.json` (+ `layouts/modulor-27.svg`) and `layouts/modulor-13.json` (+ `layouts/modulor-13.svg`).
- **Theme**: `themes/corbusier-light.json`.
- **Keys (`keys.json`)**: `cmd-shift-0`, `cmd-shift-9`, `cmd-shift-m`, and dot-syntax mod bindings `cmd-alt-{b,n,p,r,q,a,e,c,l}` (`modulor-bar.<command>`).
- **Mods (all `mod.json` use `"place": "none"`):**
  - `modulor-bar` (`main.js`, `alerts.js`, `spawner.js`, `probe.py`, `agy-statusline.sh`, `icons/*.svg`)
  - `modulor-pane`, `modulor-queue`, `modulor-quota`, `modulor-strip`, `modulor-memory`, `modulor-git`, `modulor-swarm`, `modulor-cost`, `modulor-log`, `modulor-blueprint`, `modulor-planche`.
- **Telemetry Contract (`probe.py`)**:
  Outputs `{ ts, latest_email, active_emails, accounts, terminals, conflicts, memory, usage }`. Reads `agy` sessions when present, `MODULOR_MEMORY_DB` SQLite when set (else indexes local repo markdown docs), and caches quota history, usage ledger, and prices under `~/.cache/herdr-modulor/`.

## Watch out

- **Light-mode settings**: Pair `corbusier-light` with `"appearance": "light"` in `settings.json` (`minimum_contrast: 4.2` recommended).
- **Dot vs colon in `keys.json`**: Mod commands in `keys.json` MUST use dot syntax (`"modulor-bar.blueprints"`), never colons (`modulor-bar:blueprints`).
- **`.when()` callback convention in `gpui-kit`**: `.when(cond, (el) => el.child(...))` mutates/returns `el`; returning a raw child without `el.child(...)` replaces the parent element.
- **`image()` root path**: `image(path)` resolves relative to `appHome()`; external image artifacts must be staged into a subdir like `.planche-thumbs/` inside `appHome()`.
- **Checking guard**: Always guard background loops, `exec`, `notify`, `setBadge`, `setWindowTitle`, and `nextCommand` with `if (checking()) return;` so `herdr-app check` exits cleanly.
- **Home-directory git safety**: Never run `--untracked-files=normal` when `root === home()`.

## Done when

- `for m in modulor-bar modulor-pane modulor-queue modulor-quota modulor-strip modulor-memory modulor-git modulor-swarm modulor-cost modulor-log modulor-blueprint modulor-planche; do herdr-app check ~/.config/herdr-app/mods/$m || exit 1; done` exits `0`.
- `python3 -m json.tool` succeeds on all `.json` files in `layouts/`, `themes/`, `keys.json`, and `mods/*/`.
- `python3 mods/modulor-bar/probe.py | python3 -m json.tool` prints valid JSON (`ts`, `accounts`, `terminals`, `conflicts`, `memory`, `usage`) in `<1s` with zero PII.
- `herdr-app status` returns `"errors": []` with both `modulor-27` and `modulor-13` operational.
