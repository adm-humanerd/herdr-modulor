# Modulor — Multi-Agent Bauhaus & Le Corbusier Command Wall for Herdr

A functionalist **light-only** workspace layout, multi-agent board composer, and 12-mod telemetry suite for [Herdr App](https://herdr.dev), inspired by *Le Modulor* grids and Le Corbusier's *Polychromie Architecturale*.

Designed to orchestrate **3–6+ parallel coding agents** across projects, git worktrees, and heterogeneous harnesses (`claude`, `codex`, `agy`, `gemini`, `opencode`, `pi`) on a 27" monitor (`modulor-27`) without hiding behind modal popups or zoom modes—paired with a compact single-strip focus view for a 13" laptop (`modulor-13`).

![Modulor 27-inch Multi-Agent Command Wall](preview.png)

## What's New in v2

- **Multi-Agent Default Boards (`modulor-blueprint`, `Cmd+Alt+B` / `Cmd+Alt+N`)**:
  - 5 built-in architectural grids: **`Quad 2×2 · 4 Agents` (★ default)**, `Quad 3+1` (3 agents + Planche), `Triptych 1·1·1` (3 full-height columns), `Unité 58:42` (Lead + 2 workers), and `Hex Wall 3×2` (6 agents).
  - Assign different project folders (`Deal 1..N`) and different CLI harnesses per slot, enable **automatic Git Worktree isolation** (`~/.herdr/worktrees/<repo>-slotN`), or snapshot your live multi-pane tab with **`+ Save Current Board`**.
- **Planche Command Desk (`modulor-planche`, `Cmd+Alt+P`)**:
  - Dedicated 3-mode board tab (`WALL` · `DOCS` · `PORTS`): inspect all active agents side by side, read markdown plans/walkthroughs and `.png` screenshot artifacts with one-click checklist **`Spawn ↗`**, and monitor local dev-server ports (`:3000`, `:4321`, etc.).
- **Project, Harness & Write-Collision Badges (`modulor-pane`, `modulor-queue`)**:
  - Every pane header displays its `[project]` repo chip, harness tag (`CLAUDE`, `CODEX`, `AGY`, …), `MEM n` activity badge, and a pulsing **`CONFLICT`** warning whenever two agents concurrently edit the same file or non-worktree checkout.
- **Quota Burn Rate & Sparklines (`modulor-quota`, `modulor-bar`)**:
  - Logs rolling quota history to `~/.cache/herdr-modulor/quota-history.jsonl` and computes linear-regression burn rate (`-%/h`), exhaustion ETA (`0% in 1h31m` or `>reset`), and a 16-bar sparkline per bucket.
- **Subagent & Swarm Tree (`modulor-swarm`)**:
  - Dedicated right-column deck combining `invoke_subagent`/`swarm` transcript spawns with live Herdr child terminals (`terminal.peek`).
- **Incremental Token & API-Equivalent Ledger (`modulor-cost`, `Cmd+Alt+C`)**:
  - Byte-offset incremental ledger (`usage-ledger.json`) summing full transcripts across 7 days with editable `/1M` rates (`prices.json`) and a bottom-bar `≈$X.XX` pill.
- **Live Folder Log Watcher (`modulor-log`, `Cmd+Alt+L`)**:
  - Persistent draggable window using `watchFolder` + `tail` to highlight errors/warnings and notify on new failures.
- **Smart Alerts & Dynamic Window Title (`modulor-bar`)**:
  - Non-duplicating operational alerts for quota thresholds (`≤35%` / `≤15%`), quota refills, context (`≥80%` / `≥90%`), and stale probe (`>60s`), plus live summary in the OS window title (`MODULOR · REV · G5H % · space`).

## Quick Install

In Herdr, ask your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this layout: herdr.dev/layouts/adm-humanerd/herdr-modulor
```

Or install manually by reading [`RECIPE.md`](RECIPE.md) or copying `layouts/`, `themes/corbusier-light.json`, `mods/modulor-*`, and merging `keys.json` into `~/.config/herdr-app/`.

Set `"theme": "corbusier-light"` and `"appearance": "light"` in `~/.config/herdr-app/settings.json`.

## Keyboard Shortcuts (`keys.json`)

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+0` / `Cmd+Shift+9` | Switch between `modulor-27` (27" wall) and `modulor-13` (13" focus) |
| `Cmd+Shift+M` | Toggle right-hand Inspector column (`panel`) |
| `Cmd+Alt+B` | Open **Blueprints** board composer & snapshot saver |
| `Cmd+Alt+N` | Launch starred default multi-agent board (`+ Quad`) |
| `Cmd+Alt+P` | Open or focus **Planche** (`WALL` · `DOCS` · `PORTS`) |
| `Cmd+Alt+R` | Jump to next urgent (`REVIEW` / `UNREAD`) agent |
| `Cmd+Alt+Q` / `Cmd+Alt+C` | Open **Quota** ledger / **Cost** 7-day token ledger |
| `Cmd+Alt+A` / `Cmd+Alt+E` | Open **Queue** dialog (13") / **Memory** inspector popup |
| `Cmd+Alt+L` | Toggle **Log Watch** persistent window |

## Optional Telemetry & Extensions

1. **Zero-config Workspace Docs (`CONTEXTUAL DOCS`)**: Out of the box, `probe.py` indexes `AGENTS.md`, `CLAUDE.md`, `MEMORY.md`, `.cursorrules`, `RECIPE.md`, and `README.md` inside each focused project repo to populate `CONTEXTUAL DOCS` and the 2D `MEMORY GRAPH`.
2. **External SQLite Memory DB (`MODULOR_MEMORY_DB`)**: Export `MODULOR_MEMORY_DB=/path/to/memory.db` (compatible with `slots`, `memories`, `nodes`, `edges` schema) to switch the inspector to live SQLite recall + ontology graph traversal (always opened read-only `?mode=ro`).
3. **Antigravity (`agy`) Multi-Account Quotas**: Add to `~/.gemini/antigravity-cli/settings.json`:
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
4. **Other Coding Agents (`claude`, `codex`, `gemini`, `opencode`, `pi`)**: Panes, Review Queue, Spaces, `[project]` chips, Blueprints, `Planche`, `Workspace Git`, and `+ Panel` work natively via Herdr APIs for any CLI agent without `agy` installed.

## License

MIT
