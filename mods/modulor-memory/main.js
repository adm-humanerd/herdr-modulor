import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  spaces,
  panes,
  focused,
  theme,
  shared,
  props,
  run,
  openOverlay,
  closeOverlay,
  checking,
} from "herdr";

const KEY_TELEMETRY = "modulor.telemetry";

function splitAddr(addr) {
  if (!addr) return { machine: "__local__", id: "" };
  const idx = addr.indexOf("/");
  if (idx > 0) return { machine: addr.slice(0, idx), id: addr.slice(idx + 1) };
  return { machine: "__local__", id: addr };
}

function fmtAge(sec) {
  if (typeof sec !== "number" || sec < 0) return "";
  if (sec < 5) return "now";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function fmtBytes(n) {
  if (typeof n !== "number") return "0";
  if (n < 1000) return `${n}B`;
  return `${(n / 1000).toFixed(1)}K`;
}

function shortModel(m) {
  if (!m) return "agy";
  const s = String(m)
    .replace(/^models\//, "")
    .replace(/-preview$/i, "");
  if (/orchestrator\s*\(carbon\)/i.test(s)) return "Orch Carbon";
  if (/flash-worker/i.test(s) || /^gemini-.*flash/i.test(s)) return "Gemini Flash";
  if (/^claude-/i.test(s)) return s.replace(/^claude-/i, "").slice(0, 14);
  if (/^gemini-/i.test(s)) return `G${s.replace(/^gemini-/i, "")}`.slice(0, 14);
  return s.replace(/\([^)]*$/, "").trim().slice(0, 14);
}

function callBadgeMeta(c, t) {
  if (c.state === "running") return ["RUN", t.blocked, true];
  if (c.state === "error") return ["ERR", t.blocked, false];
  const map = {
    READ: t.done,
    EDIT: t.working,
    WRITE: t.blocked,
    EXEC: "#191816",
    FIND: t.muted,
    MCP: "#1B4F79",
    RES: t.muted,
    WEB: t.muted,
    AGENT: "#191816",
    FLOW: t.muted,
  };
  return [c.badge || "TOOL", map[c.badge] ?? t.muted, false];
}

function fileOpMeta(op, t) {
  if (op === "write") return ["W", t.blocked];
  if (op === "edit") return ["E", t.working];
  return ["R", t.done];
}

function memBadge(kind, t) {
  const map = {
    lesson: ["LESSON", t.blocked],
    crystal: ["CRYSTAL", "#191816"],
    memory: ["MEMORY", t.done],
    recall: ["RECALL", t.done],
    slot: ["SLOT", "#191816"],
    write: ["WRITE", t.blocked],
    graph: ["GRAPH", t.working],
    concept: ["CONCEPT", "#191816"],
    entity: ["ENTITY", t.done],
    knowledge: ["KNOW", t.working],
    article: ["DOC", t.muted],
    rule: ["RULE", "#191816"],
    doc: ["DOC", t.done],
  };
  const [txt, bg] = map[kind] ?? [String(kind ?? "MEM").toUpperCase().slice(0, 7), t.muted];
  return div()
    .px(4)
    .h(14)
    .flex_none()
    .flex()
    .items_center()
    .bg(bg)
    .text_color("#FAF8F4")
    .font_family("Geist Mono")
    .text_size(8.5)
    .font_semibold()
    .child(txt);
}

function secBar(title, rightText, t) {
  return h_flex()
    .h(21)
    .px(10)
    .flex_none()
    .items_center()
    .justify_between()
    .bg(t.raised)
    .border_b(1)
    .border_color(t.border)
    .child(
      div()
        .font_family("Geist Mono")
        .text_size(9.5)
        .font_semibold()
        .text_color(t.foreground)
        .child(title),
    )
    .when(Boolean(rightText), (el) =>
      el.child(
        div()
          .font_family("Geist Mono")
          .text_size(9)
          .text_color(t.muted)
          .child(rightText),
      ),
    );
}

function computeGraphLayout(graph, width, height) {
  const rawNodes = graph?.nodes ?? [];
  const rawEdges = graph?.edges ?? [];
  if (!rawNodes.length) return { nodes: [], edges: [] };

  const tierMap = new Map();
  for (const n of rawNodes) {
    const tr = Number.isFinite(n.tier) ? n.tier : 1;
    if (!tierMap.has(tr)) tierMap.set(tr, []);
    tierMap.get(tr).push(n);
  }
  const tiers = [...tierMap.keys()].sort((a, b) => a - b);
  const nCols = tiers.length;
  const xFracByCol =
    nCols === 1 ? [0.5] : nCols === 2 ? [0.22, 0.78] : nCols === 3 ? [0.17, 0.5, 0.83] : [0.13, 0.38, 0.63, 0.87];

  const posMap = {};
  const laidNodes = [];
  const cardH = 22;

  tiers.forEach((tierVal, colIdx) => {
    const group = tierMap.get(tierVal) ?? [];
    const colFrac = xFracByCol[colIdx] ?? 0.5;
    const count = group.length;
    group.forEach((node, rowIdx) => {
      const yFrac =
        count === 1 ? 0.5 : 0.17 + (rowIdx * 0.66) / Math.max(1, count - 1);
      const lbl = String(node.label || node.id || "");
      const boxW = Math.min(104, Math.max(56, Math.round(lbl.length * 5.8 + 16)));
      const cxPx = Math.round(colFrac * width);
      const cyPx = Math.round(yFrac * height);
      const leftPx = Math.max(4, Math.min(width - boxW - 4, Math.round(cxPx - boxW / 2)));
      const topPx = Math.max(4, Math.min(height - cardH - 4, Math.round(cyPx - cardH / 2)));
      const boxCx = leftPx + boxW / 2;
      const boxCy = topPx + cardH / 2;
      const laid = {
        ...node,
        boxW,
        boxH: cardH,
        leftPx,
        topPx,
        cxPct: `${((boxCx / width) * 100).toFixed(2)}%`,
        cyPct: `${((boxCy / height) * 100).toFixed(2)}%`,
      };
      posMap[node.id] = laid;
      laidNodes.push(laid);
    });
  });

  const laidEdges = [];
  for (const e of rawEdges) {
    const a = posMap[e.src];
    const b = posMap[e.dst];
    if (!a || !b) continue;
    laidEdges.push({ ...e, from: a, to: b });
  }

  return { nodes: laidNodes, edges: laidEdges };
}

export default class ModulorMemory extends View {
  init(_props, cx) {
    this.mode = props()?.mode === "global" ? "global" : "focused";
    this.selectedSlot = null;
    this.slotsOpen = false;
    this.graphW = 336;
    if (checking()) return;
    cx.timer.every(1500, (cx) => cx.notify());
  }

  resolveFocus(tel) {
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const addr = f?.terminal || pane?.terminal || null;
    const { machine, id } = splitAddr(addr);
    const mp = tel[machine] ?? tel.__local__ ?? null;
    const term = id ? mp?.terminals?.[id] ?? null : null;
    const allAgy = [];
    for (const [mk, mval] of Object.entries(tel)) {
      for (const [tid, tinfo] of Object.entries(mval?.terminals ?? {})) {
        const target = mk === "__local__" ? tid : `${mk}/${tid}`;
        allAgy.push({ target, tid, ...tinfo });
      }
    }
    return { f, pane, addr, id, machine, mp, term, allAgy };
  }

  renderGraph(graph, t, cx) {
    const H = 140;
    const W = Math.max(220, this.graphW || 336);
    const { nodes, edges } = computeGraphLayout(graph, W, H);
    if (!nodes.length) {
      return div()
        .px(10)
        .py(8)
        .text_size(10.5)
        .text_color(t.dim)
        .child("No active context graph for focused pane.");
    }

    const nodeBorderAndBg = (kind) => {
      if (kind === "focus") return ["#191816", "#FAF8F4", "#191816"];
      if (kind === "edit" || kind === "write") return ["#FAF8F4", t.foreground, t.working];
      if (kind === "file" || kind === "skill" || kind === "doc") return ["#FAF8F4", t.foreground, t.done];
      if (kind === "rule" || kind === "concept") return ["#FAF8F4", t.foreground, "#191816"];
      if (kind === "lesson") return ["#FAF8F4", t.foreground, t.blocked];
      return [t.chrome, t.foreground, t.border];
    };

    const canPaint = Boolean(cx?.window?.paint_path);

    return div()
      .id("mm-graph")
      .relative()
      .w_full()
      .h(H)
      .flex_none()
      .bg(t.surface)
      .border_b(1)
      .border_color(t.border)
      .on_size_change((sz, cx) => {
        if (sz?.width > 60 && Math.abs(sz.width - this.graphW) > 4) {
          this.graphW = Math.round(sz.width);
          cx.notify();
        }
      })
      .when(canPaint, (el) =>
        el.children(
          edges.map((e, i) => {
            const p = PathBuilder.stroke(e.active ? 1.8 : 1.1)
              .move_to(e.from.cxPct, e.from.cyPct)
              .line_to(e.to.cxPct, e.to.cyPct)
              .build();
            const col = e.active ? t.blocked : "#B5AEA0";
            return div()
              .id(`mm-ge-${i}`)
              .absolute()
              .inset(0)
              .size_full()
              .child(cx.window.paint_path(p, col));
          }),
        ),
      )
      .children(
        nodes.map((n, i) => {
          const [bg, fg, bcol] = nodeBorderAndBg(n.kind);
          return div()
            .id(`mm-gn-${i}`)
            .absolute()
            .left(n.leftPx)
            .top(n.topPx)
            .w(n.boxW)
            .h(n.boxH)
            .px(5)
            .flex()
            .items_center()
            .justify_center()
            .bg(bg)
            .border(1)
            .border_color(bcol)
            .tooltip(`${n.kind}: ${n.label}`)
            .child(
              div()
                .truncate()
                .font_family(n.kind === "focus" ? "Geist Mono" : "Geist")
                .text_size(9.5)
                .font_semibold()
                .text_color(fg)
                .child(n.label),
            );
        }),
      );
  }

  renderFocusedInspector(ctx, t, cx) {
    const { pane, id, mp, term, allAgy } = ctx;
    const mem = mp?.memory ?? { available: false, slots: [], entries: [], nodes: [], activations: [] };

    if (!term) {
      const cwd = pane?.cwd ? String(pane.cwd).replace(/^\/Users\/[^/]+/, "~") : "—";
      return v_flex()
        .id("mm-shell-empty")
        .flex_1()
        .min_h(0)
        .children([
          v_flex()
            .p(10)
            .gap(6)
            .bg(t.surface)
            .border_b(1)
            .border_color(t.border)
            .child(
              div()
                .font_family("Geist Mono")
                .text_size(10.5)
                .font_semibold()
                .text_color(t.foreground)
                .child(`SHELL ${id || pane?.title || "PANE"}`),
            )
            .child(
              div()
                .text_size(10.5)
                .text_color(t.muted)
                .child(`Focused pane is a shell (${cwd}). Select an agent pane or view GLOBAL.`),
            )
            .child(
              h_flex()
                .gap(4)
                .mt(2)
                .children(
                  allAgy.slice(0, 4).map((a) =>
                    div()
                      .id(`mm-jmp-${a.tid}`)
                      .px(6)
                      .h(20)
                      .flex()
                      .items_center()
                      .bg("#191816")
                      .text_color("#FAF8F4")
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .cursor_pointer()
                      .on_click(() => run("agent.focus", { terminal: a.target }))
                      .child(`${a.tid} ${a.work_dir ? `· ${a.work_dir}` : ""}`),
                  ),
                )
                .child(
                  div()
                    .id("mm-go-global")
                    .px(6)
                    .h(20)
                    .flex()
                    .items_center()
                    .bg(t.raised)
                    .border(1)
                    .border_color(t.border)
                    .text_color(t.foreground)
                    .font_family("Geist Mono")
                    .text_size(9.5)
                    .cursor_pointer()
                    .on_click((_e, cx) => {
                      this.mode = "global";
                      cx.notify();
                    })
                    .child("GLOBAL"),
                ),
            ),
        ]);
    }

    const calls = (term.live_calls ?? []).slice(0, 6);
    const files = (term.working_files ?? []).slice(0, 5);
    const skills = term.active_skills ?? [];
    const artifacts = term.artifacts ?? [];
    const ctxMems = (term.ctx_memories ?? []).slice(0, 5);
    const graph = term.ctx_graph ?? { nodes: [], edges: [] };
    const slots = mem.slots ?? [];
    const runCount = calls.filter((c) => c.state === "running").length;

    return v_flex()
      .flex_1()
      .min_h(0)
      .child(
        // Carbon black identity bar for the active inspected agy panel
        v_flex()
          .px(10)
          .py(7)
          .gap(3)
          .flex_none()
          .bg("#191816")
          .border_b(1)
          .border_color("#191816")
          .child(
            h_flex()
              .items_center()
              .justify_between()
              .gap(6)
              .child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(11)
                      .font_bold()
                      .text_color("#FAF8F4")
                      .child(term.terminal),
                  )
                  .child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .text_color("#CFC8B8")
                      .child(`${shortModel(term.model)} · ${term.steps ?? 0} st`),
                  ),
              )
              .when(Boolean(term.work_dir), (el) =>
                el.child(
                  div()
                    .px(5)
                    .h(16)
                    .flex()
                    .items_center()
                    .bg("#2D2A26")
                    .text_color("#FAF8F4")
                    .font_family("Geist Mono")
                    .text_size(9)
                    .truncate()
                    .max_w(130)
                    .child(term.work_dir),
                ),
              ),
          )
          .child(
            div()
              .truncate()
              .text_size(10.5)
              .text_color("#E8E2D5")
              .child(term.title || "Active agent session"),
          ),
      )
      .when(skills.length > 0 || artifacts.length > 0, (el) =>
        el.child(
          h_flex()
            .px(10)
            .py(4)
            .gap(4)
            .flex_none()
            .flex_wrap()
            .bg(t.surface)
            .border_b(1)
            .border_color(t.border)
            .children(
              skills.map((s, idx) =>
                div()
                  .id(`mm-sk-${idx}`)
                  .px(4)
                  .h(15)
                  .flex()
                  .items_center()
                  .bg(t.done)
                  .text_color("#FAF8F4")
                  .font_family("Geist Mono")
                  .text_size(8.5)
                  .child(`SKILL ${s}`),
              ),
            )
            .children(
              artifacts.slice(0, 3).map((a, idx) =>
                div()
                  .id(`mm-art-${idx}`)
                  .px(4)
                  .h(15)
                  .flex()
                  .items_center()
                  .bg(t.raised)
                  .border(1)
                  .border_color(t.border)
                  .text_color(t.foreground)
                  .font_family("Geist Mono")
                  .text_size(8.5)
                  .child(a),
              ),
            ),
        ),
      )
      .child(
        v_flex()
          .id("mm-focus-scroll")
          .flex_1()
          .min_h(0)
          .pr(4)
          .overflow_y_scrollbar()
          // 1. LIVE CALLS
          .child(
            secBar(
              "LIVE CALLS",
              runCount > 0 ? `${runCount} RUN · ${calls.length}` : `${calls.length}`,
              t,
            ),
          )
          .when(calls.length === 0, (el) =>
            el.child(div().px(10).py(6).text_size(10).text_color(t.dim).child("No tool calls yet.")),
          )
          .children(
            calls.map((c, idx) => {
              const [badgeTxt, badgeBg, isRunning] = callBadgeMeta(c, t);
              return h_flex()
                .id(`mm-lc-${idx}`)
                .px(10)
                .py(4)
                .gap(6)
                .items_center()
                .justify_between()
                .border_b(1)
                .border_color(t.border)
                .tooltip(c.detail || c.target)
                .child(
                  h_flex()
                    .flex_1()
                    .min_w(0)
                    .gap(5)
                    .items_center()
                    .child(
                      div()
                        .w(36)
                        .h(14)
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .bg(badgeBg)
                        .text_color("#FAF8F4")
                        .font_family("Geist Mono")
                        .text_size(8.5)
                        .font_bold()
                        .when(isRunning, (b) => b.loop("opacity", { from: 0.45, to: 1, period: 900 }))
                        .child(badgeTxt),
                    )
                    .child(
                      div()
                        .truncate()
                        .font_family("Geist Mono")
                        .text_size(10)
                        .text_color(t.foreground)
                        .child(c.target || c.tool),
                    ),
                )
                .child(
                  div()
                    .flex_none()
                    .font_family("Geist Mono")
                    .text_size(9)
                    .text_color(isRunning ? t.blocked : t.dim)
                    .child(isRunning ? "live" : fmtAge(c.age_sec)),
                );
            }),
          )
          // 2. WORKING FILES
          .child(secBar("WORKING FILES", `${files.length}`, t))
          .when(files.length === 0, (el) =>
            el.child(div().px(10).py(6).text_size(10).text_color(t.dim).child("No recent file activity.")),
          )
          .children(
            files.map((wf, idx) => {
              const [opCh, opCol] = fileOpMeta(wf.last_op, t);
              const counts = `${wf.reads ? `R${wf.reads}` : ""}${wf.reads && wf.writes ? "·" : ""}${wf.writes ? `E${wf.writes}` : ""}`;
              return h_flex()
                .id(`mm-wf-${idx}`)
                .px(10)
                .py(4)
                .gap(6)
                .items_center()
                .justify_between()
                .border_b(1)
                .border_color(t.border)
                .tooltip(wf.path)
                .child(
                  h_flex()
                    .flex_1()
                    .min_w(0)
                    .gap(5)
                    .items_center()
                    .child(
                      div()
                        .w(13)
                        .h(13)
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .bg(opCol)
                        .text_color("#FAF8F4")
                        .font_family("Geist Mono")
                        .text_size(8.5)
                        .font_bold()
                        .child(opCh),
                    )
                    .child(
                      div()
                        .truncate()
                        .text_size(10.5)
                        .font_medium()
                        .text_color(t.foreground)
                        .child(wf.name),
                    )
                    .when(Boolean(wf.dir), (el) =>
                      el.child(div().truncate().text_size(9.5).text_color(t.dim).child(wf.dir)),
                    ),
                )
                .child(
                  h_flex()
                    .flex_none()
                    .gap(5)
                    .items_center()
                    .child(
                      div()
                        .font_family("Geist Mono")
                        .text_size(9)
                        .text_color(t.muted)
                        .child(counts),
                    )
                    .child(
                      div()
                        .font_family("Geist Mono")
                        .text_size(9)
                        .text_color(t.dim)
                        .child(fmtAge(wf.age_sec)),
                    ),
                );
            }),
          )
          // 3. 2D MEMORY GRAPH
          .child(
            secBar(
              "MEMORY GRAPH",
              `${graph.nodes?.length ?? 0}N · ${graph.edges?.length ?? 0}E`,
              t,
            ),
          )
          .child(this.renderGraph(graph, t, cx))
          // 4. CONTEXTUAL MEMORY / DOCS MATCHES
          .child(secBar(mem?.mode === "sqlite" ? "CONTEXTUAL MEMORY" : "CONTEXTUAL DOCS", `${ctxMems.length}`, t))
          .when(ctxMems.length === 0, (el) =>
            el.child(
              div()
                .px(10)
                .py(6)
                .text_size(10)
                .text_color(t.dim)
                .child("No matching workspace rules or docs."),
            ),
          )
          .children(
            ctxMems.map((e, idx) =>
              v_flex()
                .id(`mm-cm-${idx}`)
                .px(10)
                .py(5)
                .gap(2)
                .border_b(1)
                .border_color(t.border)
                .child(
                  h_flex()
                    .items_center()
                    .justify_between()
                    .gap(5)
                    .child(
                      h_flex()
                        .gap(4)
                        .items_center()
                        .child(memBadge(e.kind, t))
                        .when((e.matched ?? []).length > 0, (el) =>
                          el.child(
                            div()
                              .font_family("Geist Mono")
                              .text_size(9)
                              .text_color(t.done)
                              .truncate()
                              .child(e.matched.join(" · ")),
                          ),
                        ),
                    )
                    .child(
                      div()
                        .font_family("Geist Mono")
                        .text_size(9)
                        .text_color(t.dim)
                        .child(`${e.hits ? `${e.hits}x · ` : ""}${fmtAge(e.age_sec)}`),
                    ),
                )
                .child(
                  div()
                    .text_size(10)
                    .text_color(t.foreground)
                    .child(e.preview),
                ),
            ),
          )
          // 5. COLLAPSIBLE WORKING SLOTS
          .child(
            h_flex()
              .id("mm-slots-hdr")
              .h(22)
              .px(10)
              .flex_none()
              .items_center()
              .justify_between()
              .bg(t.raised)
              .border_b(1)
              .border_color(t.border)
              .cursor_pointer()
              .on_click((_e, cx) => {
                this.slotsOpen = !this.slotsOpen;
                cx.notify();
              })
              .child(
                h_flex()
                  .gap(5)
                  .items_center()
                  .child(
                    svg(
                      this.slotsOpen
                        ? "mods/modulor-bar/icons/chevron-down.svg"
                        : "mods/modulor-bar/icons/chevron-right.svg",
                    )
                      .size(10)
                      .text_color(t.muted),
                  )
                  .child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .font_semibold()
                      .text_color(t.foreground)
                      .child("WORKING SLOTS"),
                  ),
              )
              .child(
                div()
                  .font_family("Geist Mono")
                  .text_size(9)
                  .text_color(t.muted)
                  .child(`${slots.length}`),
              ),
          )
          .when(this.slotsOpen, (el) =>
            el.children(
              slots.slice(0, 8).map((s) => {
                const isSel = this.selectedSlot === s.label;
                return v_flex()
                  .id(`mm-fslot-${s.label}`)
                  .px(10)
                  .py(5)
                  .gap(2)
                  .border_b(1)
                  .border_color(t.border)
                  .bg(isSel ? t.raised : t.chrome)
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    this.selectedSlot = isSel ? null : s.label;
                    cx.notify();
                  })
                  .child(
                    h_flex()
                      .items_center()
                      .justify_between()
                      .child(
                        div()
                          .font_family("Geist Mono")
                          .text_size(10)
                          .font_semibold()
                          .text_color(t.foreground)
                          .child(s.label),
                      )
                      .child(
                        div()
                          .font_family("Geist Mono")
                          .text_size(9)
                          .text_color(t.muted)
                          .child(`${fmtBytes(s.size)}/${fmtBytes(s.limit)}`),
                      ),
                  )
                  .when(isSel && Boolean(s.preview), (pEl) =>
                    pEl.child(
                      div()
                        .text_size(10)
                        .text_color(t.muted)
                        .child(s.preview),
                    ),
                  );
              }),
            ),
          ),
      );
  }

  renderGlobalDb(ctx, t) {
    const mp = ctx.mp ?? ctx.tel?.__local__ ?? null;
    const mem = mp?.memory ?? { available: false, slots: [], entries: [], nodes: [], activations: [] };
    const activations = mem.activations ?? [];
    const slots = mem.slots ?? [];
    const entries = mem.entries ?? [];
    const nodes = mem.nodes ?? [];

    return v_flex()
      .id("mm-global-scroll")
      .flex_1()
      .min_h(0)
      .pr(4)
      .overflow_y_scrollbar()
      .child(secBar("GLOBAL MCP CALLS", `${activations.length}`, t))
      .when(activations.length === 0, (el) =>
        el.child(div().px(10).py(6).text_size(10).text_color(t.dim).child("No recent MCP calls.")),
      )
      .children(
        activations.slice(0, 8).map((a, idx) =>
          v_flex()
            .id(`mm-ga-${idx}`)
            .px(10)
            .py(5)
            .gap(2)
            .border_b(1)
            .border_color(t.border)
            .child(
              h_flex()
                .items_center()
                .justify_between()
                .child(
                  h_flex()
                    .gap(5)
                    .items_center()
                    .child(memBadge(a.kind, t))
                    .child(div().font_family("Geist Mono").text_size(10).font_semibold().text_color(t.foreground).child(a.tool)),
                )
                .child(div().font_family("Geist Mono").text_size(9.5).text_color(t.muted).child(`${a.terminal} · ${fmtAge(a.age_sec)}`)),
            )
            .when(Boolean(a.target), (el) =>
              el.child(div().truncate().text_size(10).text_color(t.muted).child(a.target)),
            ),
        ),
      )
      .child(secBar("WORKING SLOTS", `${slots.length}`, t))
      .children(
        slots.slice(0, 10).map((s) => {
          const isSel = this.selectedSlot === s.label;
          return v_flex()
            .id(`mm-gs-${s.label}`)
            .px(10)
            .py(5)
            .gap(2)
            .border_b(1)
            .border_color(t.border)
            .bg(isSel ? t.raised : t.chrome)
            .cursor_pointer()
            .on_click((_e, cx) => {
              this.selectedSlot = isSel ? null : s.label;
              cx.notify();
            })
            .child(
              h_flex()
                .items_center()
                .justify_between()
                .child(div().font_family("Geist Mono").text_size(10).font_semibold().text_color(t.foreground).child(s.label))
                .child(div().font_family("Geist Mono").text_size(9).text_color(t.muted).child(`${fmtBytes(s.size)}/${fmtBytes(s.limit)}`)),
            )
            .when(isSel && Boolean(s.preview), (el) =>
              el.child(div().text_size(10).text_color(t.muted).child(s.preview)),
            );
        }),
      )
      .child(secBar("RECENT MEMORIES", `${entries.length}`, t))
      .children(
        entries.slice(0, 6).map((e, idx) =>
          v_flex()
            .id(`mm-ge-${idx}`)
            .px(10)
            .py(5)
            .gap(2)
            .border_b(1)
            .border_color(t.border)
            .child(
              h_flex()
                .items_center()
                .justify_between()
                .child(memBadge(e.kind, t))
                .child(div().font_family("Geist Mono").text_size(9).text_color(t.dim).child(fmtAge(e.age_sec))),
            )
            .child(div().text_size(10).text_color(t.foreground).child(e.preview)),
        ),
      )
      .child(secBar("ONTOLOGY NODES", `${nodes.length}`, t))
      .children(
        nodes.slice(0, 6).map((n, idx) =>
          h_flex()
            .id(`mm-gnn-${idx}`)
            .px(10)
            .py(4)
            .items_center()
            .justify_between()
            .border_b(1)
            .border_color(t.border)
            .child(
              h_flex()
                .flex_1()
                .min_w(0)
                .gap(5)
                .items_center()
                .child(memBadge(n.kind, t))
                .child(div().truncate().text_size(10).text_color(t.foreground).child(n.label)),
            )
            .child(div().font_family("Geist Mono").text_size(9).text_color(t.dim).child(fmtAge(n.age_sec))),
        ),
      );
  }

  render(cx) {
    const t = theme();
    const tel = shared(KEY_TELEMETRY) ?? {};
    const focusCtx = this.resolveFocus(tel);
    const isFocusMode = this.mode === "focused";
    const busy = Boolean(isFocusMode && focusCtx.term?.agent_busy);
    const isOverlay = Boolean(props()?.overlay);

    return v_flex()
      .id("modulor-memory")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(26)
          .px(10)
          .flex_none()
          .items_center()
          .justify_between()
          .bg(t.raised)
          .border_b(1)
          .border_color(t.border)
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(div().text_size(11).font_semibold().child("Inspector"))
              .when(busy, (el) =>
                el.child(
                  div()
                    .px(4)
                    .h(14)
                    .flex()
                    .items_center()
                    .bg(t.blocked)
                    .text_color("#FAF8F4")
                    .font_family("Geist Mono")
                    .text_size(8.5)
                    .font_bold()
                    .loop("opacity", { from: 0.45, to: 1, period: 900 })
                    .child("RUN"),
                ),
              ),
          )
          .child(
            h_flex()
              .gap(3)
              .items_center()
              .child(
                div()
                  .id("mm-mode-focused")
                  .px(5)
                  .h(16)
                  .flex()
                  .items_center()
                  .bg(isFocusMode ? "#191816" : t.surface)
                  .border(1)
                  .border_color(isFocusMode ? "#191816" : t.border)
                  .text_color(isFocusMode ? "#FAF8F4" : t.muted)
                  .font_family("Geist Mono")
                  .text_size(9)
                  .font_semibold()
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    this.mode = "focused";
                    cx.notify();
                  })
                  .child("FOCUSED"),
              )
              .child(
                div()
                  .id("mm-mode-global")
                  .px(5)
                  .h(16)
                  .flex()
                  .items_center()
                  .bg(!isFocusMode ? "#191816" : t.surface)
                  .border(1)
                  .border_color(!isFocusMode ? "#191816" : t.border)
                  .text_color(!isFocusMode ? "#FAF8F4" : t.muted)
                  .font_family("Geist Mono")
                  .text_size(9)
                  .font_semibold()
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    this.mode = "global";
                    cx.notify();
                  })
                  .child("GLOBAL"),
              )
              .when(isOverlay, (el) =>
                el.child(
                  div()
                    .id("mm-close")
                    .w(16)
                    .h(16)
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .on_click(() => closeOverlay())
                    .child(svg("mods/modulor-bar/icons/close.svg").size(10).text_color(t.muted)),
                ),
              ),
          ),
      )
      .child(
        isFocusMode
          ? this.renderFocusedInspector(focusCtx, t, cx)
          : this.renderGlobalDb({ ...focusCtx, tel }, t),
      );
  }
}
