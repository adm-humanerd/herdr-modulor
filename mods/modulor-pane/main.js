import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, shared, home } from "herdr";

const KEY_TELEMETRY = "modulor.telemetry";

function splitAddr(addr) {
  if (!addr) return { machine: "__local__", id: "" };
  const idx = addr.indexOf("/");
  if (idx > 0) return { machine: addr.slice(0, idx), id: addr.slice(idx + 1) };
  return { machine: "__local__", id: addr };
}

function fmtTok(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n <= 0) return null;
  if (n < 1000) return String(Math.round(n));
  if (n < 999500) return `${Math.round(n / 1000)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function shortModel(name) {
  if (!name) return "";
  const map = {
    "gemini-pro-orchestrator": "Orch Carbon",
    "gemini-pro-orchestrator-neon": "Orch Neon",
    "gemini-pro-orchestrator-argon": "Orch Argon",
    "gemini-flash-worker-agy": "Flash",
    "Orchestrator (Carbon)": "Orch Carbon",
    "Orchestrator (Neon)": "Orch Neon",
    "Orchestrator (Argon)": "Orch Argon",
  };
  if (map[name]) return map[name];
  return name
    .replace(/^Gemini\s+/i, "G")
    .replace(/^Claude\s+/i, "")
    .replace(/\s*\((Low|Medium|High|XHigh|Max)\)/i, (_, e) => ` ${e[0]}`)
    .slice(0, 14);
}

const cleanTitle = (s) =>
  (s ?? "")
    .replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "")
    .replace(/^\[ [!.] \] /, "")
    .trim();

function folderShort(cwd) {
  if (!cwd) return "";
  const h = home();
  if (cwd === h) return "~";
  return cwd.startsWith(h + "/") ? "~/" + cwd.slice(h.length + 1) : cwd;
}

function harnessTag(p) {
  const raw = (p?.app || p?.program?.key || p?.program?.name || "").toLowerCase();
  if (!raw) return "";
  if (raw.includes("claude")) return "CLAUDE";
  if (raw.includes("codex")) return "CODEX";
  if (raw.includes("antigravity") || raw === "agy") return "AGY";
  if (raw.includes("gemini")) return "GEMINI";
  if (raw.includes("opencode")) return "OPENCODE";
  if (raw === "pi") return "PI";
  return "";
}

function modBadgeMeta(modName, t) {
  const m = (modName || "").toLowerCase();
  if (m === "modulor-planche") return ["PLANCHE", "#191816"];
  if (m === "changes") return ["DIFF", t.working];
  if (m === "files") return ["FILES", t.done];
  if (m === "modulor-log") return ["LOGS", t.blocked];
  return ["MOD", "#191816"];
}

function miniMeter(pct, focused, t) {
  if (typeof pct !== "number") return null;
  const filled = Math.max(1, Math.min(4, Math.ceil((pct / 100) * 4)));
  const warn = pct >= 80;
  const activeCol = warn ? (focused ? "#F28B7D" : t.blocked) : focused ? "#FAF8F4" : t.foreground;
  const emptyCol = focused ? "#4A4741" : t.border;
  const bars = [];
  for (let i = 0; i < 4; i++) {
    bars.push(div().w(3).h(8).bg(i < filled ? activeCol : emptyCol));
  }
  return h_flex().gap(1).items_center().children(bars);
}

export default class ModulorPane extends View {
  init() {
    this.hovered = false;
  }

  button(id, icon, command, args, focused, t) {
    return div()
      .id(id)
      .p(3)
      .cursor_pointer()
      .text_color(focused ? "#C9C3B6" : t.dim)
      .hover((s) => s.bg(focused ? "#32302B" : t.hover).text_color(focused ? "#FAF8F4" : t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/modulor-bar/icons/${icon}.svg`).size(13));
  }

  render() {
    const t = theme();
    const allPanes = panes();
    const paneId = props()?.pane;
    const p = allPanes.find((x) => x.pane === paneId);
    if (!p) return div();

    const tabPanes = allPanes.filter((x) => x.tab === p.tab);
    const paneNum = Math.max(1, tabPanes.findIndex((x) => x.pane === paneId) + 1);

    const store = shared(KEY_TELEMETRY) ?? {};
    const sp = splitAddr(p.terminal);
    const tel = store[sp.machine];
    const info = tel?.terminals?.[sp.id] ?? null;
    const multiAcct = Object.keys(tel?.accounts ?? {}).length > 1;

    const st = p.status;
    const isModPane = !p.terminal && Boolean(p.mod);
    const isFocused = Boolean(p.focused);

    let bg = "#EFECE4";
    let borderCol = t.border;
    let fg = t.dim;
    let subFg = t.dim;

    if (isFocused) {
      bg = "#191816";
      borderCol = "#191816";
      fg = "#FAF8F4";
      subFg = "#C9C3B6";
    } else if (st === "blocked") {
      bg = "#F5E6E3";
      borderCol = "#D8B8B2";
      fg = t.foreground;
      subFg = t.muted;
    } else if (st === "done") {
      bg = "#E6EEF5";
      borderCol = "#B9CCE0";
      fg = t.foreground;
      subFg = t.muted;
    } else if (st === "working" || isModPane) {
      bg = t.chrome;
      borderCol = t.border;
      fg = t.foreground;
      subFg = t.muted;
    }

    const rawTitle = info?.title || cleanTitle(p.title);
    const label = isModPane
      ? p.name || rawTitle || p.mod
      : rawTitle || folderShort(p.cwd) || p.program?.name || sp.id || "shell";
    const hTag = isModPane ? "" : harnessTag(p);
    const heterogeneous = new Set(tabPanes.map((x) => harnessTag(x)).filter(Boolean)).size > 1;
    const rawCwdName =
      p.cwd && p.cwd !== home() ? p.cwd.replace(/\/+$/, "").split("/").pop() : "";
    const projLabel = !isModPane ? (info?.work_dir || rawCwdName || "") : "";
    const projShort = projLabel.length > 16 ? projLabel.slice(0, 15) + "…" : projLabel;
    const projTip = p.branch ? `${projLabel} (${p.branch})` : projLabel;
    const conflicts = info?.conflicts ?? [];
    const conflictTip = conflicts
      .map((c) => `⚠ ${c.kind === "file" ? "File" : "Repo"} collision on ${c.target} with ${c.peers.join(", ")}`)
      .join("\n");
    const modelStr = shortModel(info?.model);
    const displayModel = modelStr
      ? (heterogeneous && hTag ? `${hTag} · ${modelStr}` : modelStr)
      : (hTag && hTag !== "AGY" ? hTag : (heterogeneous && hTag ? hTag : ""));
    const mcpActs = info?.mcp_activations ?? [];
    const recentMcp = mcpActs.filter((a) => (a.age_sec ?? 9999) < 180);
    const mcpTip = mcpActs.length > 0
      ? mcpActs.slice(0, 3).map((a) => `${a.tool}${a.target ? `: ${a.target}` : ""}`).join("\n")
      : "";
    const ctxStr = fmtTok(info?.ctx_tokens);
    const outStr = fmtTok(info?.out_tokens);
    const pct = info?.ctx_pct;
    const highCtx = typeof pct === "number" && pct >= 80;

    const tipParts = [];
    if (info?.email) tipParts.push(`Account: ${info.email}`);
    if (info?.model) tipParts.push(`Model: ${info.model}`);
    if (ctxStr) tipParts.push(`Context: ${ctxStr}${typeof pct === "number" ? ` (${pct.toFixed(1)}%)` : ""}`);
    if (outStr) tipParts.push(`Output: ${outStr}`);
    const tipText = tipParts.join(" · ");

    return h_flex()
      .id(`m-pane-${paneId}`)
      .size_full()
      .px(8)
      .gap(7)
      .items_center()
      .bg(bg)
      .border_b(1)
      .border_color(borderCol)
      .text_size(11.5)
      .on_hover((on, cx) => {
        this.hovered = on;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane: paneId }))
      .child(
        div()
          .w(18)
          .h(18)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .font_family("Geist Mono")
          .text_size(11)
          .font_bold()
          .bg(isFocused ? "#302E2A" : t.raised)
          .text_color(isFocused ? "#FAF8F4" : t.foreground)
          .child(String(paneNum)),
      )
      .when(isModPane, (el) => {
        const [mbTxt, mbBg] = modBadgeMeta(p.mod, t);
        return el.child(
          div()
            .flex_none()
            .px(5)
            .h(18)
            .flex()
            .items_center()
            .bg(isFocused ? "#302E2A" : mbBg)
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(9.5)
            .font_bold()
            .child(mbTxt),
        );
      })
      .when(!isModPane && st === "blocked", (el) =>
        el.child(
          div()
            .flex_none()
            .px(6)
            .h(18)
            .flex()
            .items_center()
            .bg(t.blocked)
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(10)
            .font_bold()
            .when(!isFocused, (b) => b.loop("opacity", { from: 0.62, to: 1, period: 1600 }))
            .child("REVIEW"),
        ),
      )
      .when(!isModPane && st === "done", (el) =>
        el.child(
          div()
            .flex_none()
            .px(6)
            .h(18)
            .flex()
            .items_center()
            .bg(t.done)
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(10)
            .font_bold()
            .child("UNREAD"),
        ),
      )
      .when(!isModPane && st === "working", (el) =>
        el.child(
          div()
            .flex_none()
            .px(5)
            .h(18)
            .flex()
            .items_center()
            .bg(t.working)
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(10)
            .font_bold()
            .child("WORK"),
        ),
      )
      .when(!isModPane && (st === "idle" || !st), (el) =>
        el.child(
          div()
            .flex_none()
            .px(5)
            .h(18)
            .flex()
            .items_center()
            .border(1)
            .border_color(isFocused ? "#4A4741" : t.border)
            .text_color(subFg)
            .font_family("Geist Mono")
            .text_size(9.5)
            .child("IDLE"),
        ),
      )
      .when(conflicts.length > 0, (el) =>
        el.child(
          div()
            .id(`pane-cnf-${paneId}`)
            .flex_none()
            .px(4)
            .h(16)
            .flex()
            .items_center()
            .bg(t.blocked)
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(9)
            .font_bold()
            .loop("opacity", { from: 0.55, to: 1, period: 1200 })
            .tooltip(conflictTip)
            .child("CONFLICT"),
        ),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .font_medium()
          .text_color(fg)
          .child(label),
      )
      .when(Boolean(projShort), (el) =>
        el.child(
          div()
            .id(`pane-proj-${paneId}`)
            .flex_none()
            .px(4)
            .h(16)
            .flex()
            .items_center()
            .bg(isFocused ? "#2D2A26" : t.raised)
            .border(1)
            .border_color(isFocused ? "#4A4741" : t.border)
            .font_family("Geist Mono")
            .text_size(9.5)
            .text_color(isFocused ? "#E8E2D5" : t.foreground)
            .tooltip(projTip)
            .child(projShort),
        ),
      )
      .when(multiAcct && Boolean(info?.email), (el) =>
        el.child(
          div()
            .flex_none()
            .px(4)
            .h(16)
            .flex()
            .items_center()
            .border(1)
            .border_color(isFocused ? "#4A4741" : t.border)
            .font_family("Geist Mono")
            .text_size(9.5)
            .text_color(subFg)
            .child(info.email.split("@")[0]),
        ),
      )
      .when(mcpActs.length > 0, (el) =>
        el.child(
          div()
            .id(`pane-mcp-${paneId}`)
            .flex_none()
            .px(4)
            .h(16)
            .flex()
            .items_center()
            .bg(recentMcp.length > 0 ? t.done : isFocused ? "#302E2A" : t.raised)
            .border(1)
            .border_color(recentMcp.length > 0 ? t.done : isFocused ? "#4A4741" : t.border)
            .font_family("Geist Mono")
            .text_size(9.5)
            .font_semibold()
            .text_color(recentMcp.length > 0 || isFocused ? "#FAF8F4" : t.muted)
            .when(Boolean(mcpTip), (x) => x.tooltip(mcpTip))
            .child(`MEM ${mcpActs.length}`),
        ),
      )
      .when(Boolean(displayModel), (el) =>
        el.child(
          div()
            .flex_none()
            .text_size(10.5)
            .text_color(subFg)
            .child(displayModel),
        ),
      )
      .when(Boolean(ctxStr), (el) =>
        el.child(
          h_flex()
            .id(`pane-tok-${paneId}`)
            .flex_none()
            .gap(5)
            .items_center()
            .when(Boolean(tipText), (x) => x.tooltip(tipText))
            .child(miniMeter(pct, isFocused, t))
            .child(
              div()
                .font_family("Geist Mono")
                .text_size(10.5)
                .font_semibold()
                .text_color(highCtx ? (isFocused ? "#F28B7D" : t.blocked) : fg)
                .child(typeof pct === "number" ? `CTX ${ctxStr} ${Math.round(pct)}%` : `CTX ${ctxStr}`),
            )
            .when(Boolean(outStr), (x) =>
              x.child(
                div()
                  .font_family("Geist Mono")
                  .text_size(10)
                  .text_color(subFg)
                  .child(`· OUT ${outStr}`),
              ),
            ),
        ),
      )
      .when(this.hovered, (el) =>
        el
          .child(this.button(`mp-r-${paneId}`, "split-right", "pane.split", { direction: "right", pane: paneId }, isFocused, t))
          .child(this.button(`mp-d-${paneId}`, "split-down", "pane.split", { direction: "down", pane: paneId }, isFocused, t))
          .child(this.button(`mp-x-${paneId}`, "close", "pane.close", { pane: paneId }, isFocused, t)),
      );
  }
}
