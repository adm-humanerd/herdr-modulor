import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  spaces,
  theme,
  shared,
  props,
  run,
  exec,
  notify,
  closeOverlay,
  checking,
} from "herdr";

const KEY_TELEMETRY = "modulor.telemetry";

function fmtTok(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 999500) return `${Math.round(n / 1000)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function fmtUsd(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return "≈$0.00";
  if (v >= 100) return `≈$${v.toFixed(0)}`;
  return `≈$${v.toFixed(2)}`;
}

function shortModel(name) {
  if (!name) return "";
  return String(name)
    .replace(/^models\//, "")
    .replace(/Orchestrator\s*\(([^)]+)\)/i, "Orch $1")
    .replace(/gemini-flash-worker-agy/i, "Flash")
    .replace(/^claude-/i, "")
    .replace(/^gemini-/i, "G")
    .slice(0, 16);
}

export default class ModulorCost extends View {
  init() {
    if (checking()) return;
  }

  openPrices(pricesPath) {
    if (!pricesPath || checking()) return;
    exec("open", [pricesPath]).catch(() => {
      notify({ title: "Prices config", body: pricesPath, level: "info" });
    });
  }

  render() {
    const t = theme();
    const store = shared(KEY_TELEMETRY) ?? {};
    const activeSpace = spaces().find((s) => s.active);
    const mk = activeSpace?.machine ?? "__local__";
    const tel = store[mk] ?? store.__local__ ?? {};
    const usage = tel.usage ?? null;
    const today = usage?.today ?? { in: 0, cache: 0, out: 0, est_usd: 0, sessions: 0 };
    const days7 = usage?.days_7 ?? [];
    const total7d = usage?.total_7d_usd ?? 0;
    const topSessions = usage?.top_sessions ?? [];
    const pricesPath = usage?.prices_path ?? "";

    const sum7In = days7.reduce((s, d) => s + (d.in ?? 0), 0);
    const sum7Cache = days7.reduce((s, d) => s + (d.cache ?? 0), 0);
    const sum7Out = days7.reduce((s, d) => s + (d.out ?? 0), 0);
    const cacheHitPct =
      sum7In + sum7Cache > 0 ? Math.round((sum7Cache / (sum7In + sum7Cache)) * 100) : 0;
    const maxDayUsd = Math.max(1, ...days7.map((d) => d.est_usd ?? 0));

    return v_flex()
      .id("modulor-cost")
      .size_full()
      .bg(t.popover)
      .border(1)
      .border_color(t.input)
      .text_color(t.foreground)
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
              .child(div().text_size(12).font_semibold().child("TOKEN & API-EQUIV LEDGER"))
              .child(
                div()
                  .px(5)
                  .py(1)
                  .bg("#302E2A")
                  .font_family("Geist Mono")
                  .text_size(9.5)
                  .text_color("#CFC8B8")
                  .child("ULTRA · API ≈$"),
              ),
          )
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .when(Boolean(pricesPath), (el) =>
                el.child(
                  div()
                    .id("mc-prices")
                    .px(6)
                    .py(2)
                    .border(1)
                    .border_color("#4A4741")
                    .font_family("Geist Mono")
                    .text_size(10)
                    .text_color("#CFC8B8")
                    .cursor_pointer()
                    .tooltip("Open prices.json to adjust $/1M token rates")
                    .hover((s) => s.bg("#302E2A").text_color("#FAF8F4"))
                    .on_click(() => this.openPrices(pricesPath))
                    .child("prices.json"),
                ),
              )
              .child(
                div()
                  .id("mc-close")
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
      .child(
        v_flex()
          .id("mc-scroll")
          .flex_1()
          .min_h(0)
          .p(12)
          .gap(12)
          .overflow_y_scrollbar()
          // Summary KPI cards
          .child(
            h_flex()
              .gap(10)
              .child(
                v_flex()
                  .flex_1()
                  .p(10)
                  .gap(4)
                  .bg(t.surface)
                  .border(1)
                  .border_color(t.border)
                  .child(
                    h_flex()
                      .justify_between()
                      .items_center()
                      .child(div().font_family("Geist Mono").text_size(9.5).text_color(t.muted).child("TODAY"))
                      .child(div().font_family("Geist Mono").text_size(9.5).text_color(t.dim).child(`${today.sessions ?? 0} SESS`)),
                  )
                  .child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(18)
                      .font_bold()
                      .text_color(t.foreground)
                      .child(fmtUsd(today.est_usd)),
                  )
                  .child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .text_color(t.muted)
                      .child(`IN ${fmtTok(today.in)} · CA ${fmtTok(today.cache)} · OUT ${fmtTok(today.out)}`),
                  ),
              )
              .child(
                v_flex()
                  .flex_1()
                  .p(10)
                  .gap(4)
                  .bg(t.surface)
                  .border(1)
                  .border_color(t.border)
                  .child(
                    h_flex()
                      .justify_between()
                      .items_center()
                      .child(div().font_family("Geist Mono").text_size(9.5).text_color(t.muted).child("7-DAY ROLLING"))
                      .child(div().font_family("Geist Mono").text_size(9.5).text_color(t.done).child(`${cacheHitPct}% CACHED`)),
                  )
                  .child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(18)
                      .font_bold()
                      .text_color(t.foreground)
                      .child(fmtUsd(total7d)),
                  )
                  .child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .text_color(t.muted)
                      .child(`IN ${fmtTok(sum7In)} · CA ${fmtTok(sum7Cache)} · OUT ${fmtTok(sum7Out)}`),
                  ),
              ),
          )
          // 7-day bar chart
          .when(days7.length > 0, (el) =>
            el.child(
              v_flex()
                .p(10)
                .gap(6)
                .bg(t.surface)
                .border(1)
                .border_color(t.border)
                .child(
                  h_flex()
                    .justify_between()
                    .items_center()
                    .child(div().font_family("Geist Mono").text_size(10).font_semibold().child("DAILY API EQUIVALENT (7D)"))
                    .child(div().font_family("Geist Mono").text_size(9.5).text_color(t.dim).child(`AVG ${fmtUsd(total7d / Math.max(1, days7.length))}/D`)),
                )
                .children(
                  days7.map((d) => {
                    const pct = Math.max(2, Math.min(100, Math.round(((d.est_usd ?? 0) / maxDayUsd) * 100)));
                    const isToday = d.date === today.date;
                    return h_flex()
                      .gap(8)
                      .items_center()
                      .child(
                        div()
                          .w(42)
                          .font_family("Geist Mono")
                          .text_size(9.5)
                          .when(isToday, (el) => el.font_semibold())
                          .text_color(isToday ? t.foreground : t.dim)
                          .child(d.date.slice(5)),
                      )
                      .child(
                        h_flex()
                          .flex_1()
                          .h(8)
                          .bg(t.raised)
                          .child(div().w(`${pct}%`).h_full().bg(isToday ? t.working : "#191816")),
                      )
                      .child(
                        div()
                          .w(54)
                          .text_right()
                          .font_family("Geist Mono")
                          .text_size(9.5)
                          .text_color(isToday ? t.foreground : t.muted)
                          .child(fmtUsd(d.est_usd)),
                      );
                  }),
                ),
            ),
          )
          // Top sessions table
          .child(
            v_flex()
              .border(1)
              .border_color(t.border)
              .bg(t.surface)
              .child(
                h_flex()
                  .h(24)
                  .px(10)
                  .items_center()
                  .justify_between()
                  .bg(t.raised)
                  .border_b(1)
                  .border_color(t.border)
                  .child(div().font_family("Geist Mono").text_size(10).font_semibold().child("RECENT SESSIONS (FULL TRANSCRIPT)"))
                  .child(div().font_family("Geist Mono").text_size(9.5).text_color(t.dim).child(`${topSessions.length}`)),
              )
              .when(topSessions.length === 0, (sEl) =>
                sEl.child(div().p(10).text_size(11).text_color(t.muted).child("No usage ledger entries yet.")),
              )
              .children(
                topSessions.map((s, idx) =>
                  h_flex()
                    .id(`mc-s-${idx}`)
                    .px(10)
                    .py(6)
                    .gap(8)
                    .items_center()
                    .justify_between()
                    .border_b(1)
                    .border_color(t.border)
                    .when(Boolean(s.live), (r) =>
                      r
                        .cursor_pointer()
                        .hover((st) => st.bg(t.hover))
                        .on_click(() => {
                          const addr = mk === "__local__" ? s.tid : `${mk}/${s.tid}`;
                          run("agent.focus", { terminal: addr });
                          closeOverlay(props().overlay);
                        }),
                    )
                    .child(
                      h_flex()
                        .flex_1()
                        .min_w(0)
                        .gap(6)
                        .items_center()
                        .child(
                          div()
                            .px(4)
                            .h(14)
                            .flex_none()
                            .flex()
                            .items_center()
                            .bg(s.live ? t.done : t.raised)
                            .text_color(s.live ? "#FAF8F4" : t.dim)
                            .font_family("Geist Mono")
                            .text_size(8.5)
                            .font_bold()
                            .child(s.live ? `${s.tid}` : s.date.slice(5)),
                        )
                        .child(
                          div()
                            .truncate()
                            .text_size(10.5)
                            .font_medium()
                            .text_color(t.foreground)
                            .child(s.title),
                        ),
                    )
                    .child(
                      h_flex()
                        .flex_none()
                        .gap(8)
                        .items_center()
                        .when(Boolean(s.model), (mEl) =>
                          mEl.child(
                            div()
                              .font_family("Geist Mono")
                              .text_size(9)
                              .text_color(t.dim)
                              .child(shortModel(s.model)),
                          ),
                        )
                        .child(
                          div()
                            .font_family("Geist Mono")
                            .text_size(9.5)
                            .text_color(t.muted)
                            .child(`${fmtTok((s.in ?? 0) + (s.cache ?? 0))}/${fmtTok(s.out ?? 0)}`),
                        )
                        .child(
                          div()
                            .w(48)
                            .text_right()
                            .font_family("Geist Mono")
                            .text_size(10)
                            .font_semibold()
                            .text_color(t.foreground)
                            .child(fmtUsd(s.est_usd)),
                        ),
                    ),
                ),
              ),
          ),
      );
  }
}
