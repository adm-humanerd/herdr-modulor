import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  spaces,
  panes,
  knownAgents,
  exec,
  home,
  theme,
  shared,
  setShared,
  run,
  notify,
  props,
  closeOverlay,
  checking,
} from "herdr";

const KEY_BP = "modulor.blueprints";
const KEY_TEL = "modulor.telemetry";
const KEY_LAUNCH = "modulor.launchRequest";

const PRESETS = [
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

const PY_SCAN_REPOS = [
  "import json, os, pathlib",
  "home = pathlib.Path.home()",
  "repos = []",
  "seen = set()",
  "for base in [home / 'Projects', home]:",
  "  if not base.is_dir(): continue",
  "  for p in base.iterdir():",
  "    if p.name.startswith('.') or not p.is_dir(): continue",
  "    sp = str(p)",
  "    if sp in seen: continue",
  "    if (p / '.git').exists():",
  "      seen.add(sp)",
  "      repos.append((p.stat().st_mtime, p.name, sp))",
  "repos.sort(reverse=True)",
  "print(json.dumps([{'name': n, 'path': sp} for _, n, sp in repos[:16]]))",
].join("\n");

function shortFolder(p) {
  if (!p) return "(current dir)";
  const h = home().replace(/\/+$/, "");
  if (p === h) return "~";
  return p.startsWith(h + "/") ? "~/" + p.slice(h.length + 1) : p;
}

function baseName(p) {
  if (!p) return "";
  const s = String(p).replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) || s : s;
}

function splitAddr(addr) {
  if (!addr) return { machine: "__local__", id: "" };
  const idx = addr.indexOf("/");
  if (idx > 0) return { machine: addr.slice(0, idx), id: addr.slice(idx + 1) };
  return { machine: "__local__", id: addr };
}

function agentArgvFromName(name) {
  const low = String(name || "").toLowerCase();
  if (low.includes("antigravity") || low === "agy") return ["agy"];
  if (low.includes("claude")) return ["claude"];
  if (low.includes("codex")) return ["codex"];
  if (low.includes("gemini")) return ["gemini"];
  if (low.includes("opencode")) return ["opencode"];
  if (low === "pi") return ["pi"];
  return ["agy"];
}

function slotKindLabel(s) {
  if (s.kind === "shell") return "SHELL";
  if (s.kind === "mod") {
    if (s.mod === "modulor-planche") return "PLANCHE";
    if (s.mod === "changes") return "DIFF";
    if (s.mod === "files") return "FILES";
    if (s.mod === "modulor-log") return "LOGS";
    return s.mod || "MOD";
  }
  const cmd = Array.isArray(s.argv) && s.argv.length > 0 ? s.argv[0] : "auto";
  return cmd.toUpperCase();
}

function miniWireframe(geometry, t, active) {
  const borderCol = active ? "#FAF8F4" : t.muted;
  const box = (flex) =>
    div().flex_1().size_full().border(1).border_color(borderCol).when(flex, (e) => e.flex());
  if (geometry === "triptych") {
    return h_flex().w(24).h(16).gap(1).children([box(), box(), box()]);
  }
  if (geometry === "unite") {
    return h_flex()
      .w(24)
      .h(16)
      .gap(1)
      .child(div().w(13).h_full().border(1).border_color(borderCol))
      .child(v_flex().flex_1().h_full().gap(1).children([box(), box()]));
  }
  if (geometry === "hex") {
    return v_flex()
      .w(24)
      .h(16)
      .gap(1)
      .child(h_flex().flex_1().gap(1).children([box(), box(), box()]))
      .child(h_flex().flex_1().gap(1).children([box(), box(), box()]));
  }
  return v_flex()
    .w(24)
    .h(16)
    .gap(1)
    .child(h_flex().flex_1().gap(1).children([box(), box()]))
    .child(h_flex().flex_1().gap(1).children([box(), box()]));
}

export default class ModulorBlueprint extends View {
  init(_p, cx) {
    this.selectedId = this.getStore().defaultId || "quad-4";
    this.selectedSlot = 0;
    this.installedAgents = [];
    this.repos = [];
    this.draftSlots = null;
    this.saveMode = false;
    this.saveName = "";
    this.nameInput = InputState.new({ placeholder: "Custom board name (e.g. My 5P Wall)" });
    this.nameInput.on("change", (_e, cx) => {
      this.saveName = this.nameInput.value();
      cx.notify();
    });
    this.nameInput.on("submit", (_e, cx) => this.saveCurrentBoard(cx));

    if (checking()) return;

    cx.spawn(async (cx) => {
      try {
        const ag = await knownAgents();
        this.installedAgents = ag.filter((a) => a.installed && Array.isArray(a.run) && a.run.length > 0);
      } catch {}
      try {
        const r = await exec("python3", ["-c", PY_SCAN_REPOS], { timeout: 4000 });
        if (r.code === 0 && r.stdout) this.repos = JSON.parse(r.stdout);
      } catch {}
      cx.notify();
    });
  }

  getStore() {
    const raw = shared(KEY_BP);
    return raw && typeof raw === "object"
      ? { defaultId: "quad-4", worktreeIsolate: false, custom: [], presetOverrides: {}, ...raw }
      : { defaultId: "quad-4", worktreeIsolate: false, custom: [], presetOverrides: {} };
  }

  updateStore(patch) {
    const cur = this.getStore();
    setShared(KEY_BP, { ...cur, ...patch });
  }

  allTemplates() {
    const st = this.getStore();
    return [...PRESETS, ...(st.custom ?? [])];
  }

  currentTemplate() {
    const st = this.getStore();
    const list = this.allTemplates();
    const base = list.find((b) => b.id === this.selectedId) ?? PRESETS[0];
    const ov = st.presetOverrides?.[base.id];
    const slots =
      ov && Array.isArray(ov.slots) && ov.slots.length === base.slots.length
        ? base.slots.map((s, i) => ({ ...s, ...ov.slots[i] }))
        : base.slots.map((s) => ({ ...s }));
    return { ...base, slots };
  }

  activeSlots() {
    if (this.draftSlots) return this.draftSlots;
    return this.currentTemplate().slots;
  }

  selectTemplate(id, cx) {
    this.selectedId = id;
    this.selectedSlot = 0;
    this.draftSlots = null;
    cx.notify();
  }

  setAllHarness(kind, argv, cx) {
    const slots = this.activeSlots().map((s) =>
      s.kind === "mod" ? s : { ...s, kind, argv: argv ? [...argv] : null },
    );
    this.draftSlots = slots;
    cx.notify();
  }

  cycleSlotTarget(idx, cx) {
    const slots = this.activeSlots().map((s) => ({ ...s }));
    const cur = slots[idx];
    const choices = [
      ...this.installedAgents.map((a) => ({ kind: "agent", argv: a.run })),
      { kind: "shell", argv: null },
      { kind: "mod", mod: "modulor-planche", name: "Planche" },
      { kind: "mod", mod: "changes", name: "Diff" },
      { kind: "mod", mod: "modulor-log", name: "Logs" },
    ];
    if (choices.length === 0) choices.push({ kind: "shell", argv: null });
    const sig = (c) =>
      c.kind === "mod" ? `m:${c.mod}` : c.kind === "shell" ? "sh" : `a:${(c.argv || []).join(",")}`;
    const curSig = sig(cur);
    const pos = choices.findIndex((c) => sig(c) === curSig);
    const next = choices[(pos + 1) % choices.length];
    slots[idx] = {
      ...cur,
      kind: next.kind,
      argv: next.argv ?? null,
      mod: next.mod,
      props: next.kind === "mod" ? {} : undefined,
      name: next.kind === "mod" ? next.name : cur.name === "Planche" || cur.name === "Diff" ? `Slot ${idx + 1}` : cur.name,
    };
    this.draftSlots = slots;
    cx.notify();
  }

  assignFolder(idx, folderPath, label, cx) {
    const slots = this.activeSlots().map((s) => ({ ...s }));
    if (!slots[idx]) return;
    slots[idx].folder = folderPath;
    if (label && slots[idx].kind !== "mod") slots[idx].name = label;
    this.draftSlots = slots;
    cx.notify();
  }

  dealReposAcrossSlots(cx) {
    const candidates = this.mergedProjects();
    if (candidates.length === 0) return;
    const slots = this.activeSlots().map((s, idx) => {
      if (s.kind === "mod") return s;
      const proj = candidates[idx % candidates.length];
      return { ...s, folder: proj.path, name: proj.name };
    });
    this.draftSlots = slots;
    cx.notify();
  }

  mergedProjects() {
    const store = shared(KEY_TEL) ?? {};
    const tel = store.__local__ ?? {};
    const out = [];
    const seen = new Set();
    for (const tinfo of Object.values(tel.terminals ?? {})) {
      const p = tinfo?.inferred_cwd;
      if (p && p !== home() && !seen.has(p)) {
        seen.add(p);
        out.push({ name: tinfo.work_dir || baseName(p), path: p, live: true });
      }
    }
    for (const r of this.repos) {
      if (!seen.has(r.path)) {
        seen.add(r.path);
        out.push({ name: r.name, path: r.path, live: false });
      }
    }
    return out;
  }

  saveSlotOverrides(cx) {
    const bp = this.currentTemplate();
    const st = this.getStore();
    const slots = this.activeSlots();
    const isCustom = (st.custom ?? []).some((c) => c.id === bp.id);
    if (isCustom) {
      const nextCustom = st.custom.map((c) => (c.id === bp.id ? { ...c, slots } : c));
      this.updateStore({ custom: nextCustom });
    } else {
      this.updateStore({
        presetOverrides: {
          ...(st.presetOverrides ?? {}),
          [bp.id]: { slots },
        },
      });
    }
    this.draftSlots = null;
    notify({ title: "Blueprint defaults saved", body: bp.name, level: "success" });
    cx.notify();
  }

  saveCurrentBoard(cx) {
    const activeSpace = spaces().find((s) => s.active);
    const activeTab = activeSpace?.tabs?.find((tb) => tb.active);
    const tabPanes = activeTab ? panes().filter((p) => p.tab === activeTab.id) : [];
    if (tabPanes.length === 0) return;

    const tel = (shared(KEY_TEL) ?? {}).__local__?.terminals ?? {};
    const slots = tabPanes.map((p, idx) => {
      if (!p.terminal && p.mod) {
        return {
          pos: `#${idx + 1}`,
          kind: "mod",
          mod: p.mod,
          props: {},
          name: p.name || p.title || p.mod,
        };
      }
      const sp = splitAddr(p.terminal);
      const info = tel[sp.id];
      const folder = info?.inferred_cwd || p.cwd || activeSpace?.folder || home();
      const projName = info?.work_dir || baseName(folder);
      if (p.program?.agent) {
        return {
          pos: `#${idx + 1}`,
          kind: "agent",
          argv: agentArgvFromName(p.program.name || p.app),
          folder,
          name: p.name || projName || `Agent ${idx + 1}`,
        };
      }
      return {
        pos: `#${idx + 1}`,
        kind: "shell",
        folder,
        name: p.name || projName || `Shell ${idx + 1}`,
      };
    });

    const nm = this.saveName.trim() || `${activeTab?.name || "Board"} (${slots.length}P)`;
    const id = `custom-${Date.now()}`;
    const newBp = {
      id,
      name: nm,
      short: nm.slice(0, 8),
      geometry: slots.length >= 5 ? "hex" : slots.length === 3 ? "triptych" : "quad",
      desc: `Saved ${slots.length}-pane board`,
      slots,
    };
    const st = this.getStore();
    this.updateStore({ custom: [...(st.custom ?? []), newBp] });
    this.selectedId = id;
    this.draftSlots = null;
    this.saveMode = false;
    this.saveName = "";
    notify({ title: "Board saved as blueprint", body: `${nm} (${slots.length} slots)`, level: "success" });
    cx.notify();
  }

  launchSelected() {
    const bp = this.currentTemplate();
    const st = this.getStore();
    const spec = { ...bp, slots: this.activeSlots() };
    setShared(KEY_LAUNCH, {
      blueprint: spec,
      worktreeIsolate: Boolean(st.worktreeIsolate),
      inPlace: Boolean(props()?.inPlace),
    });
    closeOverlay(props().overlay);
    run("modulor-bar.launch-blueprint");
  }

  render(cx) {
    const t = theme();
    const st = this.getStore();
    const templates = this.allTemplates();
    const cur = this.currentTemplate();
    const slots = this.activeSlots();
    const projects = this.mergedProjects();
    const isDefault = st.defaultId === cur.id;
    const activeSlotObj = slots[this.selectedSlot] ?? slots[0];

    return v_flex()
      .id("modulor-blueprint")
      .size_full()
      .bg(t.popover)
      .border(1)
      .border_color(t.input)
      .text_color(t.foreground)
      // Header
      .child(
        h_flex()
          .h(34)
          .px(12)
          .flex_none()
          .items_center()
          .justify_between()
          .bg("#191816")
          .text_color("#FAF8F4")
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(div().text_size(12).font_semibold().child("MODULOR BOARD BLUEPRINTS"))
              .child(
                div()
                  .px(5)
                  .py(1)
                  .bg("#302E2A")
                  .font_family("Geist Mono")
                  .text_size(9.5)
                  .text_color("#CFC8B8")
                  .child(`★ ${PRESETS.find((p) => p.id === st.defaultId)?.short ?? "Custom"}`),
              ),
          )
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                div()
                  .id("mbp-save-cur")
                  .px(6)
                  .py(2)
                  .bg(this.saveMode ? t.working : "#302E2A")
                  .border(1)
                  .border_color("#4A4741")
                  .font_family("Geist Mono")
                  .text_size(9.5)
                  .text_color("#FAF8F4")
                  .cursor_pointer()
                  .hover((s) => s.bg("#423F39"))
                  .on_click((_e, cx) => {
                    this.saveMode = !this.saveMode;
                    if (this.saveMode) this.nameInput.focus();
                    cx.notify();
                  })
                  .child("+ Save Current Board"),
              )
              .child(
                div()
                  .id("mbp-close")
                  .px(6)
                  .py(2)
                  .cursor_pointer()
                  .text_size(11)
                  .text_color("#C9C3B6")
                  .hover((s) => s.bg("#302E2A").text_color("#FAF8F4"))
                  .on_click(() => closeOverlay(props().overlay))
                  .child("ESC"),
              ),
          ),
      )
      // Optional Save Current Board bar
      .when(this.saveMode, (el) =>
        el.child(
          h_flex()
            .h(36)
            .px(12)
            .gap(8)
            .flex_none()
            .items_center()
            .bg(t.raised)
            .border_b(1)
            .border_color(t.border)
            .child(
              h_flex()
                .flex_1()
                .h(24)
                .px(8)
                .items_center()
                .bg(t.surface)
                .border(1)
                .border_color(t.input)
                .child(Input.new(this.nameInput).flex_1().h_full().text_size(11).text_color(t.foreground)),
            )
            .child(
              div()
                .id("mbp-do-save")
                .px(8)
                .h(24)
                .flex()
                .items_center()
                .bg("#191816")
                .text_color("#FAF8F4")
                .font_family("Geist Mono")
                .text_size(10)
                .font_semibold()
                .cursor_pointer()
                .on_click((_e, cx) => this.saveCurrentBoard(cx))
                .child("Save Snapshot"),
            ),
        ),
      )
      // Body: Left Template List + Right Slot Composer
      .child(
        h_flex()
          .flex_1()
          .min_h(0)
          // Left Column: Templates
          .child(
            v_flex()
              .id("mbp-list")
              .w(218)
              .h_full()
              .flex_none()
              .bg(t.chrome)
              .border_r(1)
              .border_color(t.border)
              .overflow_y_scrollbar()
              .children(
                templates.map((bp) => {
                  const sel = bp.id === cur.id;
                  const starred = st.defaultId === bp.id;
                  const isCustom = bp.id.startsWith("custom-");
                  return h_flex()
                    .id(`mbp-item-${bp.id}`)
                    .px(10)
                    .py(8)
                    .gap(8)
                    .items_center()
                    .border_b(1)
                    .border_color(t.border)
                    .bg(sel ? "#191816" : t.chrome)
                    .text_color(sel ? "#FAF8F4" : t.foreground)
                    .cursor_pointer()
                    .hover((s) => s.bg(sel ? "#191816" : t.hover))
                    .on_click((_e, cx) => this.selectTemplate(bp.id, cx))
                    .child(miniWireframe(bp.geometry, t, sel))
                    .child(
                      v_flex()
                        .flex_1()
                        .min_w(0)
                        .gap(1)
                        .child(div().truncate().text_size(11).font_semibold().child(bp.name))
                        .child(
                          div()
                            .truncate()
                            .font_family("Geist Mono")
                            .text_size(9)
                            .text_color(sel ? "#C9C3B6" : t.dim)
                            .child(`${bp.slots.length} slots`),
                        ),
                    )
                    .child(
                      div()
                        .id(`mbp-star-${bp.id}`)
                        .px(4)
                        .py(2)
                        .text_size(12)
                        .text_color(starred ? "#D99B26" : sel ? "#6B655B" : t.dim)
                        .tooltip("Set as default ★ board for + Quad / Cmd+Alt+N")
                        .on_click((_e, cx) => {
                          cx.stop_propagation();
                          this.updateStore({ defaultId: bp.id });
                          cx.notify();
                        })
                        .child(starred ? "★" : "☆"),
                    )
                    .when(isCustom, (cEl) =>
                      cEl.child(
                        div()
                          .id(`mbp-del-${bp.id}`)
                          .px(3)
                          .text_size(11)
                          .text_color(sel ? "#C9C3B6" : t.dim)
                          .hover((s) => s.text_color(t.blocked))
                          .on_click((_e, cx) => {
                            cx.stop_propagation();
                            const nextCustom = (st.custom ?? []).filter((x) => x.id !== bp.id);
                            const nextDef = st.defaultId === bp.id ? "quad-4" : st.defaultId;
                            this.updateStore({ custom: nextCustom, defaultId: nextDef });
                            if (this.selectedId === bp.id) this.selectedId = "quad-4";
                            cx.notify();
                          })
                          .child("×"),
                      ),
                    );
                }),
              ),
          )
          // Right Column: Composer
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .h_full()
              .child(
                // Quick Persona + Worktree Isolation Bar
                v_flex()
                  .px(12)
                  .py(8)
                  .gap(6)
                  .flex_none()
                  .bg(t.surface)
                  .border_b(1)
                  .border_color(t.border)
                  .child(
                    div()
                      .text_size(11)
                      .text_color(t.muted)
                      .child(cur.desc || ""),
                  )
                  .child(
                    h_flex()
                      .gap(4)
                      .flex_wrap()
                      .items_center()
                      .child(
                        div()
                          .font_family("Geist Mono")
                          .text_size(9.5)
                          .text_color(t.dim)
                          .child("ALL:"),
                      )
                      .children(
                        this.installedAgents.slice(0, 4).map((a) =>
                          div()
                            .id(`mbp-all-${a.key}`)
                            .px(5)
                            .h(18)
                            .flex()
                            .items_center()
                            .bg(t.raised)
                            .border(1)
                            .border_color(t.border)
                            .font_family("Geist Mono")
                            .text_size(9.5)
                            .cursor_pointer()
                            .hover((s) => s.bg(t.foreground).text_color(t.background))
                            .on_click((_e, cx) => this.setAllHarness("agent", a.run, cx))
                            .child(a.run[0].toUpperCase()),
                        ),
                      )
                      .child(
                        div()
                          .id("mbp-wt-toggle")
                          .px(6)
                          .h(18)
                          .flex()
                          .items_center()
                          .bg(st.worktreeIsolate ? t.done : t.surface)
                          .border(1)
                          .border_color(st.worktreeIsolate ? t.done : t.border)
                          .text_color(st.worktreeIsolate ? "#FAF8F4" : t.muted)
                          .font_family("Geist Mono")
                          .text_size(9.5)
                          .cursor_pointer()
                          .tooltip("When >=2 slots share one git repo, auto-create isolated git worktrees under ~/.herdr/worktrees")
                          .on_click((_e, cx) => {
                            this.updateStore({ worktreeIsolate: !st.worktreeIsolate });
                            cx.notify();
                          })
                          .child(st.worktreeIsolate ? "✓ Worktree Isolate" : "Worktree Isolate"),
                      ),
                  ),
              )
              // Slots list + Project Picker
              .child(
                v_flex()
                  .id("mbp-slots-scroll")
                  .flex_1()
                  .min_h(0)
                  .p(10)
                  .gap(8)
                  .overflow_y_scrollbar()
                  .children(
                    slots.map((s, idx) => {
                      const isSel = idx === this.selectedSlot;
                      const isMod = s.kind === "mod";
                      return h_flex()
                        .id(`mbp-slot-${idx}`)
                        .px(8)
                        .py(6)
                        .gap(6)
                        .items_center()
                        .justify_between()
                        .bg(isSel ? t.selected : t.surface)
                        .border(1)
                        .border_color(isSel ? t.foreground : t.border)
                        .cursor_pointer()
                        .on_click((_e, cx) => {
                          this.selectedSlot = idx;
                          cx.notify();
                        })
                        .child(
                          h_flex()
                            .gap(6)
                            .items_center()
                            .child(
                              div()
                                .w(24)
                                .h(18)
                                .flex()
                                .items_center()
                                .justify_center()
                                .bg(isSel ? "#191816" : t.raised)
                                .text_color(isSel ? "#FAF8F4" : t.foreground)
                                .font_family("Geist Mono")
                                .text_size(9.5)
                                .font_bold()
                                .child(s.pos || `#${idx + 1}`),
                            )
                            .child(
                              div()
                                .id(`mbp-kind-${idx}`)
                                .px(6)
                                .h(18)
                                .flex()
                                .items_center()
                                .bg(isMod ? t.done : "#191816")
                                .text_color("#FAF8F4")
                                .font_family("Geist Mono")
                                .text_size(9)
                                .font_bold()
                                .cursor_pointer()
                                .tooltip("Click to cycle agent / shell / mod")
                                .on_click((_e, cx) => {
                                  cx.stop_propagation();
                                  this.selectedSlot = idx;
                                  this.cycleSlotTarget(idx, cx);
                                })
                                .child(slotKindLabel(s)),
                            ),
                        )
                        .child(
                          div()
                            .flex_1()
                            .min_w(0)
                            .truncate()
                            .text_right()
                            .font_family("Geist Mono")
                            .text_size(10)
                            .text_color(t.muted)
                            .child(isMod ? (s.name || s.mod) : shortFolder(s.folder)),
                        );
                    }),
                  )
                  .when(projects.length > 0 && activeSlotObj?.kind !== "mod", (pEl) =>
                    pEl.child(
                      v_flex()
                        .mt(4)
                        .p(8)
                        .gap(6)
                        .bg(t.chrome)
                        .border(1)
                        .border_color(t.border)
                        .child(
                          h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                              div()
                                .font_family("Geist Mono")
                                .text_size(9.5)
                                .font_semibold()
                                .text_color(t.muted)
                                .child(`ASSIGN PROJECT → SLOT ${activeSlotObj?.pos || `#${this.selectedSlot + 1}`}`),
                            )
                            .child(
                              div()
                                .id("mbp-deal")
                                .px(5)
                                .h(16)
                                .flex()
                                .items_center()
                                .bg(t.surface)
                                .border(1)
                                .border_color(t.border)
                                .font_family("Geist Mono")
                                .text_size(9)
                                .text_color(t.foreground)
                                .cursor_pointer()
                                .hover((s) => s.bg(t.foreground).text_color(t.background))
                                .on_click((_e, cx) => this.dealReposAcrossSlots(cx))
                                .child("Deal 1..N"),
                            ),
                        )
                        .child(
                          h_flex()
                            .gap(4)
                            .flex_wrap()
                            .child(
                              div()
                                .id("mbp-proj-cur")
                                .px(5)
                                .h(18)
                                .flex()
                                .items_center()
                                .bg(t.surface)
                                .border(1)
                                .border_color(t.border)
                                .font_family("Geist Mono")
                                .text_size(9.5)
                                .cursor_pointer()
                                .hover((s) => s.bg(t.hover))
                                .on_click((_e, cx) => this.assignFolder(this.selectedSlot, null, `Slot ${this.selectedSlot + 1}`, cx))
                                .child("(current)"),
                            )
                            .children(
                              projects.slice(0, 12).map((pr, pi) => {
                                const matched = activeSlotObj?.folder === pr.path;
                                return div()
                                  .id(`mbp-pr-${pi}`)
                                  .px(5)
                                  .h(18)
                                  .flex()
                                  .items_center()
                                  .bg(matched ? "#191816" : t.surface)
                                  .border(1)
                                  .border_color(matched ? "#191816" : pr.live ? t.done : t.border)
                                  .text_color(matched ? "#FAF8F4" : t.foreground)
                                  .font_family("Geist Mono")
                                  .text_size(9.5)
                                  .cursor_pointer()
                                  .tooltip(pr.path)
                                  .hover((s) => s.bg(matched ? "#191816" : t.hover))
                                  .on_click((_e, cx) => this.assignFolder(this.selectedSlot, pr.path, pr.name, cx))
                                  .child(pr.name);
                              }),
                            ),
                        ),
                    ),
                  ),
              ),
          ),
      )
      // Footer
      .child(
        h_flex()
          .h(38)
          .px(12)
          .flex_none()
          .items_center()
          .justify_between()
          .bg(t.chrome)
          .border_t(1)
          .border_color(t.border)
          .child(
            div()
              .id("mbp-save-def")
              .px(8)
              .h(24)
              .flex()
              .items_center()
              .bg(t.surface)
              .border(1)
              .border_color(t.border)
              .font_family("Geist Mono")
              .text_size(10)
              .text_color(t.foreground)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.saveSlotOverrides(cx))
              .child(isDefault ? "Save ★ Slot Defaults" : "Save Slot Defaults"),
          )
          .child(
            div()
              .id("mbp-launch")
              .px(14)
              .h(26)
              .flex()
              .items_center()
              .bg("#191816")
              .text_color("#FAF8F4")
              .font_family("Geist Mono")
              .text_size(11)
              .font_bold()
              .cursor_pointer()
              .hover((s) => s.bg(t.done))
              .on_click(() => this.launchSelected())
              .child(`Launch ${cur.short || "Board"} ↗`),
          ),
      );
  }
}
