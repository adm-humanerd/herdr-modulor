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
    } else if (st === "working") {
      bg = t.chrome;
      borderCol = t.border;
      fg = t.foreground;
      subFg = t.muted;
    }

    const rawTitle = info?.title || cleanTitle(p.title);
    const label = rawTitle || folderShort(p.cwd) || p.program?.name || sp.id || "shell";
    const modelStr = shortModel(info?.model);
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
      .when(st === "blocked", (el) =>
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
      .when(st === "done", (el) =>
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
      .when(st === "working", (el) =>
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
      .when(st === "idle" || !st, (el) =>
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
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .font_medium()
          .text_color(fg)
          .child(label),
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
      .when(Boolean(modelStr), (el) =>
        el.child(
          div()
            .flex_none()
            .text_size(10.5)
            .text_color(subFg)
            .child(modelStr),
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
