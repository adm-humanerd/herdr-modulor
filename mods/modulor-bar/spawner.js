import { spaces, panes, knownAgents, exec, home, run, notify, shared, checking } from "herdr";

export const BUILT_IN_PRESETS = [
  {
    id: "quad-4",
    name: "Quad 2×2 · 4 Agents",
    short: "Quad",
    geometry: "quad",
    desc: "4 equal parallel agent panes (2×2)",
    slots: [
      { pos: "TL", kind: "agent", name: "Slot 1", folder: null, argv: null },
      { pos: "TR", kind: "agent", name: "Slot 2", folder: null, argv: null },
      { pos: "BL", kind: "agent", name: "Slot 3", folder: null, argv: null },
      { pos: "BR", kind: "agent", name: "Slot 4", folder: null, argv: null },
    ],
  },
  {
    id: "quad-3p1",
    name: "Quad 3+1 · Agents + Planche",
    short: "3+1",
    geometry: "quad",
    desc: "3 parallel agents + Planche desk (BR)",
    slots: [
      { pos: "TL", kind: "agent", name: "Slot 1", folder: null, argv: null },
      { pos: "TR", kind: "agent", name: "Slot 2", folder: null, argv: null },
      { pos: "BL", kind: "agent", name: "Slot 3", folder: null, argv: null },
      { pos: "BR", kind: "mod", name: "Planche", mod: "modulor-planche", props: {} },
    ],
  },
  {
    id: "triptych-3",
    name: "Triptych 1·1·1 · 3 Columns",
    short: "3-Col",
    geometry: "triptych",
    desc: "3 full-height agent columns side by side",
    slots: [
      { pos: "C1", kind: "agent", name: "Plan", folder: null, argv: null },
      { pos: "C2", kind: "agent", name: "Build", folder: null, argv: null },
      { pos: "C3", kind: "agent", name: "Verify", folder: null, argv: null },
    ],
  },
  {
    id: "unite-1p2",
    name: "Unité 58:42 · Lead + 2 Workers",
    short: "Unité",
    geometry: "unite",
    desc: "58% Lead column + 2 stacked workers",
    slots: [
      { pos: "L", kind: "agent", name: "Lead", folder: null, argv: null },
      { pos: "TR", kind: "agent", name: "Worker A", folder: null, argv: null },
      { pos: "BR", kind: "agent", name: "Worker B", folder: null, argv: null },
    ],
  },
  {
    id: "hex-6",
    name: "Hex Wall 3×2 · 6 Agents",
    short: "6-Grid",
    geometry: "hex",
    desc: "Heavy 6-pane multi-project command wall",
    slots: [
      { pos: "T1", kind: "agent", name: "Agent 1", folder: null, argv: null },
      { pos: "T2", kind: "agent", name: "Agent 2", folder: null, argv: null },
      { pos: "T3", kind: "agent", name: "Agent 3", folder: null, argv: null },
      { pos: "B1", kind: "agent", name: "Agent 4", folder: null, argv: null },
      { pos: "B2", kind: "agent", name: "Agent 5", folder: null, argv: null },
      { pos: "B3", kind: "agent", name: "Agent 6", folder: null, argv: null },
    ],
  },
];

export function resolvePreset(id, bpStore) {
  const store = bpStore ?? shared("modulor.blueprints") ?? {};
  const custom = (store.custom ?? []).find((c) => c.id === id);
  if (custom) return custom;
  const base = BUILT_IN_PRESETS.find((b) => b.id === id) ?? BUILT_IN_PRESETS[0];
  const ov = store.presetOverrides?.[base.id];
  if (ov && Array.isArray(ov.slots) && ov.slots.length === base.slots.length) {
    return {
      ...base,
      slots: base.slots.map((s, idx) => ({ ...s, ...ov.slots[idx] })),
    };
  }
  return base;
}

export async function pickDefaultAgentArgv() {
  try {
    const list = await knownAgents();
    const installed = list.filter((a) => a.installed && Array.isArray(a.run) && a.run.length > 0);
    const agy = installed.find((a) => a.key === "agy" || a.run[0] === "agy");
    if (agy) return agy.run;
    const claude = installed.find((a) => a.key === "claude" || a.run[0] === "claude");
    if (claude) return claude.run;
    if (installed.length > 0) return installed[0].run;
  } catch {}
  return null;
}

async function prepareWorktrees(slots) {
  const py = [
    "import json, os, subprocess, sys",
    "slots = json.loads(sys.argv[1])",
    "wt_base = os.path.expanduser('~/.herdr/worktrees')",
    "repo_counts = {}",
    "tops = {}",
    "for i, s in enumerate(slots):",
    "  if s.get('kind') != 'agent' or not s.get('folder'): continue",
    "  r = subprocess.run(['git', '-C', s['folder'], 'rev-parse', '--show-toplevel'], capture_output=True, text=True)",
    "  if r.returncode == 0:",
    "    top = r.stdout.strip()",
    "    tops[i] = top",
    "    repo_counts[top] = repo_counts.get(top, 0) + 1",
    "os.makedirs(wt_base, exist_ok=True)",
    "out = []",
    "seen_primary = set()",
    "for i, s in enumerate(slots):",
    "  top = tops.get(i)",
    "  if top and repo_counts.get(top, 0) >= 2:",
    "    if top not in seen_primary:",
    "      seen_primary.add(top)",
    "      out.append(s)",
    "      continue",
    "    rname = os.path.basename(top)",
    "    branch = f'modulor/slot-{i+1}'",
    "    wtp = os.path.join(wt_base, f'{rname}-slot{i+1}')",
    "    if not os.path.exists(os.path.join(wtp, '.git')):",
    "      subprocess.run(['git', '-C', top, 'worktree', 'add', '-B', branch, wtp], capture_output=True, text=True)",
    "    if os.path.exists(wtp):",
    "      s = dict(s); s['folder'] = wtp; s['name'] = f\"{s.get('name') or rname} (wt{i+1})\"",
    "  out.append(s)",
    "print(json.dumps(out))",
  ].join("\n");
  try {
    const res = await exec("python3", ["-c", py, JSON.stringify(slots)], { timeout: 8000 });
    if (res.code === 0 && res.stdout) return JSON.parse(res.stdout);
  } catch {}
  return slots;
}

async function waitForNewPane(cx, tabId, beforeSet, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = panes().find((p) => p.tab === tabId && !beforeSet.has(p.pane));
    if (found) return found;
    await cx.sleep(60);
  }
  return null;
}

async function openSlot(cx, tabId, anchorPane, direction, slot, defaultArgv) {
  const before = new Set(panes().map((p) => p.pane));
  if (slot.kind === "mod") {
    run("pane.split", {
      direction,
      pane: anchorPane,
      mod: slot.mod,
      props: slot.props ?? {},
    });
    const np = await waitForNewPane(cx, tabId, before);
    if (np && slot.name) run("pane.rename", { pane: np.pane, name: slot.name });
    return np?.pane ?? null;
  }
  run("pane.focus", { pane: anchorPane });
  await cx.sleep(50);
  const args = { place: direction };
  if (slot.folder) args.folder = slot.folder;
  if (slot.kind === "agent") {
    const argv = Array.isArray(slot.argv) && slot.argv.length > 0 ? slot.argv : defaultArgv;
    if (argv && argv.length > 0) args.argv = argv;
  }
  if (slot.name) args.name = slot.name;
  run("terminal.open", args);
  const np = await waitForNewPane(cx, tabId, before);
  if (np && slot.name) run("pane.rename", { pane: np.pane, name: slot.name });
  return np?.pane ?? null;
}

export async function spawnBlueprint(bp, opts, cx) {
  if (checking() || !bp || !Array.isArray(bp.slots) || bp.slots.length === 0) return null;

  const activeSpace = spaces().find((s) => s.active);
  const activeTab = activeSpace?.tabs?.find((tb) => tb.active) ?? null;
  const activeTabPanes = activeTab ? panes().filter((p) => p.tab === activeTab.id) : [];
  const canReplaceInPlace =
    Boolean(opts?.inPlace) &&
    Boolean(activeTab) &&
    activeTabPanes.length === 1 &&
    !activeTabPanes[0].program?.agent &&
    !activeTabPanes[0].mod;
  const oldTabId = canReplaceInPlace ? activeTab.id : null;

  const defaultArgv = await pickDefaultAgentArgv();
  const baseFolder = activeTabPanes[0]?.cwd || activeSpace?.folder || home();

  let slots = bp.slots.map((s) => ({
    ...s,
    folder: s.folder || baseFolder,
  }));
  if (opts?.worktreeIsolate) {
    slots = await prepareWorktrees(slots);
  }

  const s0 = slots[0];
  const beforeTabs = new Set((activeSpace?.tabs ?? []).map((tb) => tb.id));
  const tabArgs = { name: opts?.tabName || bp.short || bp.name || "Board" };
  if (s0.kind === "mod") {
    tabArgs.mod = s0.mod;
    tabArgs.props = s0.props ?? {};
  } else {
    if (s0.folder) tabArgs.folder = s0.folder;
    if (s0.kind === "agent") {
      const argv0 = Array.isArray(s0.argv) && s0.argv.length > 0 ? s0.argv : defaultArgv;
      if (argv0 && argv0.length > 0) tabArgs.argv = argv0;
    }
  }
  run("tab.new", tabArgs);

  let newTab = null;
  let p0 = null;
  const tabDeadline = Date.now() + 2400;
  while (Date.now() < tabDeadline) {
    const sp = spaces().find((s) => s.active);
    newTab = (sp?.tabs ?? []).find((tb) => !beforeTabs.has(tb.id)) ?? null;
    if (newTab) {
      const tp = panes().find((p) => p.tab === newTab.id);
      if (tp) {
        p0 = tp.pane;
        break;
      }
    }
    await cx.sleep(70);
  }
  if (!newTab || !p0) {
    notify({ title: "Blueprint launch failed", body: "Could not initialize tab", level: "error" });
    return null;
  }
  if (s0.name) run("pane.rename", { pane: p0, name: s0.name });

  if (oldTabId) {
    run("tab.close", { id: oldTabId, confirmed: true });
    await cx.sleep(80);
  }

  const geo = bp.geometry || (slots.length >= 5 ? "hex" : slots.length === 3 ? "triptych" : "quad");

  if (geo === "unite" && slots.length >= 3) {
    const p1 = await openSlot(cx, newTab.id, p0, "right", slots[1], defaultArgv);
    if (p1) {
      run("pane.resize", { pane: p0, direction: "right", px: 130 });
      await cx.sleep(60);
      await openSlot(cx, newTab.id, p1, "down", slots[2], defaultArgv);
    }
  } else if (geo === "triptych" && slots.length >= 3) {
    const p1 = await openSlot(cx, newTab.id, p0, "right", slots[1], defaultArgv);
    if (p1) {
      const p2 = await openSlot(cx, newTab.id, p1, "right", slots[2], defaultArgv);
      if (p2) {
        run("pane.resize", { pane: p0, direction: "left", px: 280 });
      }
    }
  } else if (geo === "hex" || slots.length >= 5) {
    const topPanes = [p0];
    let prev = p0;
    for (let i = 1; i < Math.min(3, slots.length); i++) {
      const np = await openSlot(cx, newTab.id, prev, "right", slots[i], defaultArgv);
      if (np) {
        topPanes.push(np);
        prev = np;
      }
    }
    if (topPanes.length === 3) {
      run("pane.resize", { pane: p0, direction: "left", px: 280 });
      await cx.sleep(60);
    }
    for (let i = 3; i < slots.length; i++) {
      const anchor = topPanes[(i - 3) % topPanes.length];
      await openSlot(cx, newTab.id, anchor, "down", slots[i], defaultArgv);
    }
  } else {
    // 2-pane or 4-pane Quad (2x2)
    const p1 = slots[1] ? await openSlot(cx, newTab.id, p0, "right", slots[1], defaultArgv) : null;
    if (slots[2]) await openSlot(cx, newTab.id, p0, "down", slots[2], defaultArgv);
    if (slots[3] && p1) await openSlot(cx, newTab.id, p1, "down", slots[3], defaultArgv);
  }

  run("pane.focus", { pane: p0 });
  return newTab.id;
}
