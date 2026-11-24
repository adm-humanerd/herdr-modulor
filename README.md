# Modulor — Warm Light Multi-Agent Command Wall for Herdr

**Modulor** is a calm, **light-only** workspace layout, multi-agent board composer, and 12-mod telemetry suite for [Herdr App](https://herdr.dev), inspired by Le Corbusier's *Le Modulor* proportion grid and *Polychromie Architecturale*.

Instead of hiding parallel coding sessions behind dark tabs or nested modals, Modulor puts **3–6+ live coding agents**—whether one CLI running across multiple repos or a mixed squad of `claude`, `codex`, `agy`, `gemini`, `opencode`, and `pi`—onto a crisp mineral-paper grid (`#FAF8F4` / `#F1EDE4` / `#E8E2D5`). Most of the screen stays quiet monochrome so **color only appears when an action matters**: Vermilion (`#B83221`) for input needed or file conflicts, Ultramarine (`#1B4F79`) for finished turns waiting to be read, and Ochre (`#8A5A0A`) for active work.

![Modulor 27-inch Multi-Agent Command Wall](preview.png)

---

## At a Glance: What's Where

On a desktop display (**`modulor-27`**), the screen divides cleanly into five functional zones. On a laptop or SSH screen (**`modulor-13`**), press `Cmd+Shift+9` to collapse everything into a compact top agent strip over one full-bleed terminal while keeping popups one keystroke away.

| Zone | What You See & Do There |
| --- | --- |
| **Left Control Column** (`272px`, collapsible to a `78px` numbered rail) | **Review Queue** (sorted `REV` → `NEW` → `WRK` → `IDL`, `[project]` tag, `!CNF` conflict mark), **Quota & Token Load** (multi-account quota bars, burn-rate ETA, 16-bar sparklines, per-pane context load), and **Spaces** (projects, git branch, `SSH` host badges). |
| **Top Board Strip** (`36px`) | Clickable tabs, automatic recovery helpers (`SHOW ALL PANELS` if zoomed, `TILE ALL` if floating, `Compose Quad` on a single empty shell), quick launchers (**`Planche`**, **`Blueprints`**, **`+ Quad`**, **`+ Panel`**, **`+ Tab`**), and right-column deck toggles (**`Quota`**, **`Memory`**, **`Swarm`**, **`Git`**). |
| **Center Command Wall** | Tiled `1px`-bordered agent panes (bordered `2px` carbon black `#191816` when focused). Every pane header stays visible (`28px`) with pane `#`, status badge, pulsing **`CONFLICT`** warning if two agents collide on edits, `[project]` folder pill, `MEM n` activity pill, harness/model tag, context/output meter, and hover split/close buttons. |
| **Right Live Inspector** (`336px`, toggle with `Cmd+Shift+M`) | Three stacked live decks: **Inspector** (`FOCUSED`/`GLOBAL`, skills, clickable artifacts & files, `#keywords`, `LIVE CALLS`, 2D `MEMORY GRAPH`, contextual project docs), **Swarm & Subagents** (`invoke_subagent`/`swarm` tree + child terminals), and **Workspace Git** (status/diff for the active agent's inferred repo). |
| **Bottom Telemetry Bar** (`28px`) | Active account tag, compact 4-cell quota meters (click or `Cmd+Alt+Q` for the full ledger), clickable `REVIEW N` / `UNREAD N` counters, live `CTX · OUT` sum, **`≈$X.XX`** 7-day API-equivalent ledger (`Cmd+Alt+C`), **`LOG`** folder log watcher (`Cmd+Alt+L`), and **`LOCAL` / `SSH`** indicator. |

---

## Quick Install (1 Minute)

### Option A — Tell Your Herdr Agent (Recommended)

In Herdr, paste this prompt into any agent pane:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this layout: herdr.dev/layouts/adm-humanerd/herdr-modulor
```

Your existing layouts stay untouched; you can switch back to Herdr's default layout anytime with `Ctrl+Shift+L`, or delete the `modulor-*` files to uninstall cleanly.

### Option B — Manual Install

1. Copy these files from this repository into `~/.config/herdr-app/`:
   - `layouts/modulor-27.json` (+ `.svg`) and `layouts/modulor-13.json` (+ `.svg`) → `~/.config/herdr-app/layouts/`
   - `themes/corbusier-light.json` → `~/.config/herdr-app/themes/`
   - `mods/modulor-*` (all 12 folders) → `~/.config/herdr-app/mods/`
   - Merge `keys.json` shortcuts into `~/.config/herdr-app/keys.json` (note the **dot syntax** `"modulor-bar.<command>"`).
2. Make sure `~/.config/herdr-app/settings.json` sets light appearance so terminal ANSI colors stay crisp on warm white backgrounds:
   ```json
   {
     "theme": "corbusier-light",
     "appearance": "light",
     "minimum_contrast": 4.2
   }
   ```
3. Run `herdr-app status` or ask your agent to verify each mod with `herdr-app check` and switch to `modulor-27`.

---

## Your First 5 Minutes: 5 Core Workflows

### 1. Launch a 4-Agent Parallel Board in One Click (`+ Quad` / `Cmd+Alt+N`)
Click **`+ Quad`** in the top bar (or press `Cmd+Alt+N`) to open a fresh `2×2` grid of four coding agents immediately. If you already opened a blank single-shell tab, click the **`Compose Quad`** pill that appears in the top bar to split that tab into your starred default board in place.

### 2. Mix Projects, Mix Harnesses & Isolate Branches (`Blueprints` / `Cmd+Alt+B`)
Press `Cmd+Alt+B` (or click **`Blueprints`**) to customize a board before spawning:
- **5 Architectural Presets**: **`Quad 2×2 · 4 Agents` (★ default)**, `Quad 3+1` (3 agents + `Planche`), `Triptych 1·1·1` (3 full-height columns), `Unité 58:42` (wide Lead + 2 workers), and `Hex Wall 3×2` (6 agents).
- **Multi-Project Dealing (`Deal 1..N`)**: Assign different local repositories to each slot automatically, or pick folders and harnesses (`claude`, `codex`, `agy`, `gemini`, `opencode`, `pi`, `shell`, or tool views like `Planche`) slot by slot.
- **Automatic Git Worktree Isolation**: Toggle `Worktree Isolate` to spawn each slot on its own detached git worktree under `~/.herdr/worktrees/<repo>-slotN` so parallel agents never clobber each other's working tree.
- **Save Your Own Layout**: Arrange panes by hand, click **`+ Save Current Board`** inside `Blueprints`, optionally click **`★ Set Default`**, and both `+ <Board>` (`Cmd+Alt+N`) and `Compose <Board>` switch to your template.

### 3. Monitor Agents, Read Plans & Watch Ports (`Planche` / `Cmd+Alt+P`)
Press `Cmd+Alt+P` (or click **`Planche`**) to open Modulor's dedicated command desk tab with three views:
- **`WALL`**: 2-column live overview cards for every running agent, active write-conflict banners, `[Focus]`, `[Docs →]`, `[+ Worktree]`, and quick-launch rows for idle repos.
- **`DOCS`**: Browse markdown plans, walkthroughs, `AGENTS.md`, `CLAUDE.md`, `README.md`, and `.png`/`.jpg` screenshot thumbnails side by side. Checklist items (`- [ ] ...`) get a **`[Spawn ↗]`** button to launch an agent pre-seeded with that task.
- **`PORTS`**: Live table of local TCP servers listening on ports `1024–65535` (`:3000`, `:4321`, etc.), polled only while the `PORTS` tab is open.

### 4. Jump to What Needs You & Catch Edit Collisions (`Cmd+Alt+R`)
- Press **`Cmd+Alt+R`** anytime to jump directly to the next `REVIEW` (blocked) or `UNREAD` (done) pane, in exact top-to-bottom visual order of `Review Queue`.
- Whenever two agents concurrently edit the **same file** or modify the **same non-worktree repository checkout**, Modulor flashes **`CONFLICT`** in red on those pane headers and **`!CNF`** in `Review Queue`.

### 5. Switch Seamlessly Between 27" Monitor & 13" Laptop
- Press **`Cmd+Shift+0`** (or click **`27"`**) for the full 3-column command wall (`modulor-27`).
- Press **`Cmd+Shift+9`** (or click **`13"`**) for the single-strip laptop view (`modulor-13`), where **`Cmd+Alt+A`** opens a centered 320×460 `Queue & Spaces` dialog without squeezing your terminal width.

---

## Understanding Every Indicator

### Status Colors & Badges

| Status / Badge | Color | Meaning |
| --- | --- | --- |
| `REV` / `REVIEW` | Vermilion `#B83221` (pulses when unfocused) | Agent is blocked or asking for confirmation/review. |
| `NEW` / `UNREAD` | Ultramarine `#1B4F79` | Agent finished a turn; output hasn't been focused yet. |
| `WRK` / `WORK` | Ochre `#8A5A0A` | Agent is actively running a tool call or generating. |
| `IDL` / `IDLE` | Quiet mineral border | Agent is idle and ready for your next prompt. |
| `CONFLICT` / `!CNF` | Vermilion `#B83221` | Two or more agents are concurrently editing the same file or non-worktree checkout. |
| `MEM n` | Monochrome / Ultramarine glow (`<180s`) | Total recent memory MCP calls recorded by that session (hover for recent targets). |

### Quota Burn Forecast & Sparkline Guide

Every quota bucket (`GEMINI 5H`, `GEMINI WK`, `3P 5H`, `3P WK`) pairs an **OLS linear-regression burn forecast** under the progress bar with a **16-bar sparkline** on the right. Hover any bucket row in `Quota & Token Load` or the `Cmd+Alt+Q` popup anytime for a live plain-English breakdown of its numbers:

| Indicator | What It Means & How It's Calculated |
| --- | --- |
| `collecting trend…` | Fewer than 2 snapshots `≥ 60s` apart have been recorded in the current reset cycle (`~/.cache/herdr-modulor/quota-history.jsonl`, 7-day retention). |
| `stable · 0%/h` | Drain rate is `< 0.05%/h` across the regression window (`90m` for `5H` buckets, `24h` for `WK` weekly buckets). |
| `-X.X%/h · >reset` (`outlasts reset`) | At the current burn pace, remaining quota stays **above `0%`** until the bucket resets. |
| `-X.X%/h · 0% in <time>` | **Projected exhaustion countdown**: at the current pace (`-X.X%/h`), quota will hit `0%` before reset (e.g., `0% in 1h31m`, `0% in 4d4h`). Turns Vermilion red (`#B83221`) on `5H` buckets whenever exhausting before reset, and on `WK` weekly buckets when `0%` ETA is **`≤ 36h`**. |
| **16-bar sparkline** (right) | Up to 16 chronological remaining-`%` samples (`0–100%` bar height) across the **current reset cycle** only; clears automatically when the window refills (`reset_time` changes or a `+10%` jump occurs). |

### Cost Ledger (`≈$X.XX`, `Cmd+Alt+C`) & Log Watcher (`LOG`, `Cmd+Alt+L`)

- **7-Day Token & API-Equivalent Ledger (`modulor-cost`)**: Walks session transcripts incrementally by byte offset (`~/.cache/herdr-modulor/usage-ledger.json`) so it never slows down, even across dozens of long sessions. Even on flat-rate subscriptions (Google AI Ultra, Claude Max, ChatGPT Pro), `≈$X.XX` estimates equivalent API value so you can spot runaway cache/output sessions—and you can customize `/1M` token prices anytime in `~/.cache/herdr-modulor/prices.json`.
- **Log Watch Window (`modulor-log`)**: Opens a persistent draggable window (`Cmd+Alt+L`) that watches any folder you pick (`watchFolder` + `tail`), highlights `ERROR` / `WARN` lines, filters to `ERR ONLY`, and notifies you when new failures land.

---

## Keyboard Shortcuts (`keys.json`)

| Shortcut | Command | Action |
| --- | --- | --- |
| `Cmd+Shift+0` / `Cmd+Shift+9` | `layout.switch:modulor-27` / `modulor-13` | Switch between 27" Command Wall and 13" Focus View |
| `Cmd+Shift+M` | `layout.toggle:panel` | Show or hide the right-hand Inspector column |
| `Cmd+Alt+B` | `modulor-bar.blueprints` | Open **Blueprints** multi-agent board composer |
| `Cmd+Alt+N` | `modulor-bar.new-board` | Launch starred default board (`+ Quad`) |
| `Cmd+Alt+P` | `modulor-bar.planche` | Open or focus **Planche** (`WALL` · `DOCS` · `PORTS`) |
| `Cmd+Alt+R` | `modulor-bar.next-review` | Jump to next urgent (`REVIEW` / `UNREAD`) agent |
| `Cmd+Alt+Q` | `modulor-bar.quota` | Open multi-account **Quota** forecast popup |
| `Cmd+Alt+C` | `modulor-bar.cost` | Open **Cost** 7-day token & API-equivalent ledger |
| `Cmd+Alt+A` | `modulor-bar.queue` | Open **Queue & Spaces** dialog (especially handy on `13"`) |
| `Cmd+Alt+E` | `modulor-bar.memory` | Open **Memory & Context Inspector** popup |
| `Cmd+Alt+L` | `modulor-bar.logs` | Toggle persistent **Log Watch** window |

---

## Compatibility & Optional Extensions

Modulor's core multi-agent features work **out of the box with zero extra setup** across all CLI harnesses (`claude`, `codex`, `agy`, `gemini`, `opencode`, `pi`):

- **Zero-config everywhere**: `Review Queue`, `[project]` chips, harness badges, `Blueprints` (`Quad 2×2` + git worktrees), `Planche` (`WALL` · `DOCS` · `PORTS`), `Workspace Git`, `Log Watch`, `+ Panel`, and `CONTEXTUAL DOCS` (indexing `AGENTS.md`, `CLAUDE.md`, `MEMORY.md`, `.cursorrules`, `RECIPE.md`, and `README.md` in each focused repo) work natively via Herdr APIs.
- **Optional — Antigravity (`agy`) Multi-Account Quotas & Burn Forecast**:
  Add the statusline hook to `~/.gemini/antigravity-cli/settings.json`:
  ```json
  {
    "statusLine": {
      "type": "command",
      "command": "~/.config/herdr-app/mods/modulor-bar/agy-statusline.sh",
      "enabled": true,
      "stack_with_default": true
    }
  }
  ```
- **Optional — External Read-Only SQLite Memory DB (`MODULOR_MEMORY_DB`)**:
  Set `export MODULOR_MEMORY_DB=/path/to/memory.db` (supporting `slots`, `memories`, `nodes`, and `edges` tables) if you want the `Memory` deck and 2D `MEMORY GRAPH` to display live SQLite recall + ontology graph traversal (always opened read-only with `?mode=ro`).

---

## FAQ & Troubleshooting

- **Why do my quota rows say `collecting trend…` right after installing?**
  Burn-rate regression waits for at least 2 quota snapshots taken `≥ 60s` apart within the same reset cycle. Use your agent for a minute or two and the forecast (`-X.X%/h · 0% in …` or `>reset`) and 16-bar sparkline will populate automatically.
- **Why does my terminal palette look washed out or dark inside a light sidebar?**
  Check `~/.config/herdr-app/settings.json` and verify `"theme": "corbusier-light"` and `"appearance": "light"` are both set (`"minimum_contrast": 4.2` recommended).
- **How do I change what `+ Quad` (`Cmd+Alt+N`) launches?**
  Open `Blueprints` (`Cmd+Alt+B`), save or select any custom board (like `Triptych 1·1·1` or your saved workspace layout), and click **`★ Set Default`**. The top button (`+ <Board>`), `Compose <Board>`, and `Cmd+Alt+N` will use your new default.
- **How do I return to Herdr's built-in layout?**
  Press `Ctrl+Shift+L` anytime to switch back to another layout, or run `herdr-app check` after any customization to confirm zero errors.

## License

MIT
