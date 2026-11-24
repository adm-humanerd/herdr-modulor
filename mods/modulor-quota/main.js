import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, layout, theme, shared, run, checking } from "herdr";

const KEY_TELEMETRY = "modulor.telemetry";

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const ch of node.children ?? []) {
    const f = findNode(ch, id);
    if (f) return f;
  }
  return null;
}

const isNarrow = () => (findNode(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function splitAddr(addr) {
  if (!addr) return { machine: "__local__", id: "" };
  const idx = addr.indexOf("/");
  if (idx > 0) return { machine: addr.slice(0, idx), id: addr.slice(idx + 1) };
  return { machine: "__local__", id: addr };
}

function fmtTok(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 999500) return `${Math.round(n / 1000)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function fmtLeft(sec) {
  if (typeof sec !== "number" || Number.isNaN(sec)) return "--";
  if (sec <= 0) return "reset";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h${String(m).padStart(2, "0")}m`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d${h}h`;
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
  return name.replace(/^Gemini\s+/i, "G").replace(/^Claude\s+/i, "").slice(0, 14);
}

function bucketLabel(key) {
  const map = {
    "gemini-5h": "GEMINI 5H",
    "gemini-weekly": "GEMINI WK",
    "3p-5h": "3P 5H",
    "3p-weekly": "3P WK",
  };
  return map[key] ?? key.toUpperCase();
}

function shortPlan(p) {
  if (!p) return "";
  return String(p).replace(/^(google ai|claude|chatgpt)\s+/i, "").trim().toUpperCase();
}

function barColor(remPct, t) {
  if (remPct <= 15) return t.blocked;
  if (remPct <= 35) return t.working;
  return t.foreground;
}

function fmtForecast(bv, bk) {
  const sp = bv?.spark;
  const burn = bv?.burn_pct_per_h;
  if (typeof burn !== "number" || !Array.isArray(sp) || sp.length < 2) return ["collecting trend…", false];
  if (burn < 0.05) return ["stable · 0%/h", false];
  if (bv.exhausts_before_reset && typeof bv.eta_empty_sec === "number") {
    const isWeekly = String(bk || "").includes("weekly");
    const warn = !isWeekly || bv.eta_empty_sec <= 36 * 3600;
    return [`-${burn.toFixed(1)}%/h · 0% in ${fmtLeft(bv.eta_empty_sec)}`, warn];
  }
  return [`-${burn.toFixed(1)}%/h · >reset`, false];
}

function sparkBars(spark, col, t) {
  const arr = Array.isArray(spark) ? spark : [];
  if (arr.length < 2) return null;
  return h_flex()
    .gap(1)
    .h(10)
    .items_end()
    .children(
      arr.slice(-16).map((v) => {
        const h = Math.max(2, Math.min(10, Math.round(((v ?? 0) / 100) * 10)));
        return div().w(2.5).h(h).bg(col || t.muted);
      }),
    );
}

export default class ModulorQuota extends View {
  init() {
    if (checking()) return;
  }

  render() {
    const t = theme();
    if (isNarrow()) return div();

    const store = shared(KEY_TELEMETRY) ?? {};
    const activeSpace = spaces().find((s) => s.active);
    const mk = activeSpace?.machine ?? "__local__";
    const tel = store[mk] ?? {};
    const foc = focused();
    const fParsed = splitAddr(foc?.terminal);
    const activeEmail = tel.terminals?.[fParsed.id]?.email ?? tel.latest_email;

    const accounts = Object.values(tel.accounts ?? {}).sort((a, b) => {
      if (a.email === activeEmail) return -1;
      if (b.email === activeEmail) return 1;
      return (a.email ?? "").localeCompare(b.email ?? "");
    });

    const spaceTabIds = new Set((activeSpace?.tabs ?? []).map((tb) => tb.id));
    const spacePanes = panes().filter((p) => spaceTabIds.has(p.tab) && p.terminal);
    let totalCtx = 0;
    let totalOut = 0;
    const paneRows = spacePanes.map((p, idx) => {
      const sp = splitAddr(p.terminal);
      const info = store[sp.machine]?.terminals?.[sp.id] ?? {};
      if (info.ctx_tokens) totalCtx += info.ctx_tokens;
      if (info.out_tokens) totalOut += info.out_tokens;
      return {
        idx: idx + 1,
        pane: p.pane,
        tid: sp.id,
        focused: Boolean(p.focused),
        status: p.status,
        model: shortModel(info.model),
        ctx: info.ctx_tokens ?? 0,
        pct: info.ctx_pct ?? 0,
        out: info.out_tokens ?? 0,
      };
    });

    const order = ["gemini-5h", "gemini-weekly", "3p-5h", "3p-weekly"];

    return v_flex()
      .id("modulor-quota")
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
          .child(div().text_size(11).font_semibold().child("Quota & Token Load"))
          .child(
            div()
              .font_family("Geist Mono")
              .text_size(10)
              .text_color(t.dim)
              .child(`${accounts.length || 0} ACCT`),
          ),
      )
      .child(
        v_flex()
          .id("mqt-scroll")
          .flex_1()
          .min_h(0)
          .pr(4)
          .overflow_y_scrollbar()
          .when(accounts.length === 0, (el) =>
            el.child(
              div()
                .px(10)
                .py(8)
                .border_b(1)
                .border_color(t.border)
                .text_size(11)
                .text_color(t.dim)
                .child("Detecting Antigravity account..."),
            ),
          )
          .children(
            accounts.map((acct, ai) => {
              const isCur = acct.email === activeEmail;
              const qEntries = Object.entries(acct.quota ?? {}).sort((a, b) => {
                const ia = order.indexOf(a[0]);
                const ib = order.indexOf(b[0]);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
              });
              return v_flex()
                .id(`mqt-acct-${ai}`)
                .border_b(1)
                .border_color(t.border)
                .child(
                  h_flex()
                    .px(10)
                    .h(24)
                    .items_center()
                    .justify_between()
                    .bg(isCur ? t.foreground : t.chrome)
                    .text_color(isCur ? t.background : t.foreground)
                    .border_b(1)
                    .border_color(t.border)
                    .child(
                      div()
                        .truncate()
                        .max_w(165)
                        .font_family("Geist Mono")
                        .text_size(10.5)
                        .font_semibold()
                        .child(acct.email),
                    )
                    .child(
                      div()
                        .font_family("Geist Mono")
                        .text_size(9.5)
                        .text_color(isCur ? "#C9C3B6" : t.dim)
                        .child(
                          `${acct.plan ? shortPlan(acct.plan) + " · " : ""}${acct.active_panes ?? 0}P`,
                        ),
                    ),
                )
                .when(qEntries.length === 0, (el) =>
                  el.child(
                    div()
                      .px(10)
                      .py(7)
                      .text_size(10.5)
                      .text_color(t.dim)
                      .child("Account verified · awaiting next agy status tick"),
                  ),
                )
                .when(qEntries.length > 0, (el) =>
                  el.child(
                    v_flex()
                      .px(10)
                      .py(7)
                      .gap(6)
                      .children(
                        qEntries.map(([bk, bv]) => {
                          const rem = bv.remaining_pct ?? 0;
                          const col = barColor(rem, t);
                          const [fcText, fcWarn] = fmtForecast(bv, bk);
                          const spEl = sparkBars(bv.spark, col, t);
                          return v_flex()
                            .gap(2)
                            .child(
                              h_flex()
                                .justify_between()
                                .items_center()
                                .child(div().text_size(10).font_semibold().text_color(t.muted).child(bucketLabel(bk)))
                                .child(
                                  h_flex()
                                    .gap(6)
                                    .items_center()
                                    .child(
                                      div()
                                        .font_family("Geist Mono")
                                        .text_size(10.5)
                                        .font_semibold()
                                        .text_color(col)
                                        .child(`${Math.round(rem)}%`),
                                    )
                                    .child(
                                      div()
                                        .font_family("Geist Mono")
                                        .text_size(9.5)
                                        .text_color(t.dim)
                                        .child(fmtLeft(bv.reset_in_sec)),
                                    ),
                                ),
                            )
                            .child(
                              h_flex()
                                .w_full()
                                .h(4)
                                .bg(t.raised)
                                .child(div().w(`${Math.max(0, Math.min(100, rem))}%`).h_full().bg(col)),
                            )
                            .child(
                              h_flex()
                                .justify_between()
                                .items_center()
                                .child(
                                  div()
                                    .font_family("Geist Mono")
                                    .text_size(9)
                                    .text_color(fcWarn ? t.blocked : t.dim)
                                    .child(fcText),
                                )
                                .when(Boolean(spEl), (el) => el.child(spEl)),
                            );
                        }),
                      ),
                  ),
                );
            }),
          )
          .child(
            h_flex()
              .h(24)
              .px(10)
              .items_center()
              .justify_between()
              .bg(t.raised)
              .border_b(1)
              .border_color(t.border)
              .child(div().text_size(10.5).font_semibold().child("Panel Load"))
              .child(
                div()
                  .font_family("Geist Mono")
                  .text_size(9.5)
                  .text_color(t.muted)
                  .child(`Σ ${fmtTok(totalCtx)} · OUT ${fmtTok(totalOut)}`),
              ),
          )
          .children(
            paneRows.map((pr) => {
              const high = pr.pct >= 80;
              const fillCol = high ? t.blocked : pr.focused ? t.foreground : t.muted;
              return v_flex()
                .id(`mqt-p-${pr.pane}`)
                .px(10)
                .py(6)
                .gap(3)
                .border_b(1)
                .border_color(t.border)
                .bg(pr.focused ? t.selected : t.chrome)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click(() => run("pane.focus", { pane: pr.pane }))
                .child(
                  h_flex()
                    .justify_between()
                    .items_center()
                    .child(
                      h_flex()
                        .gap(5)
                        .items_center()
                        .child(
                          div()
                            .px(4)
                            .h(15)
                            .flex()
                            .items_center()
                            .bg(pr.focused ? t.foreground : t.raised)
                            .text_color(pr.focused ? t.background : t.foreground)
                            .font_family("Geist Mono")
                            .text_size(9.5)
                            .font_bold()
                            .child(`#${pr.idx} ${pr.tid}`),
                        )
                        .when(Boolean(pr.model), (el) =>
                          el.child(div().text_size(10).text_color(t.muted).child(pr.model)),
                        ),
                    )
                    .child(
                      div()
                        .font_family("Geist Mono")
                        .text_size(10)
                        .font_semibold()
                        .text_color(high ? t.blocked : t.foreground)
                        .child(`${fmtTok(pr.ctx)} ${Math.round(pr.pct)}%`),
                    ),
                )
                .child(
                  h_flex()
                    .w_full()
                    .h(3)
                    .bg(t.raised)
                    .child(div().w(`${Math.max(2, Math.min(100, pr.pct))}%`).h_full().bg(fillCol)),
                );
            }),
          ),
      );
  }
}
