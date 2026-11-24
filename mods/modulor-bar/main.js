import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  spaces,
  agents,
  panes,
  focused,
  layout,
  theme,
  shared,
  setShared,
  openOverlay,
  closeOverlay,
  exec,
  readTextFile,
  appHome,
  checking,
  props,
  run,
  notify,
  playSound,
  setWindowTitle,
  nextCommand,
} from "herdr";
import { evaluateAlerts } from "./alerts.js";
import { resolvePreset, spawnBlueprint } from "./spawner.js";

const KEY_TELEMETRY = "modulor.telemetry";
const KEY_ALERTS = "modulor.alerts";
const POLL_MS = 2200;
const REMOTE_EVERY_TICKS = 4;

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

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const ch of node.children ?? []) {
    const f = findNode(ch, id);
    if (f) return f;
  }
  return null;
}

function meterColor(remPct, t) {
  if (remPct <= 15) return t.blocked;
  if (remPct <= 35) return t.working;
  return t.foreground;
}

function meterCells(remPct, t) {
  const filled = Math.max(0, Math.min(4, Math.round(((remPct ?? 0) / 100) * 4)));
  const col = meterColor(remPct ?? 100, t);
  const cells = [];
  for (let i = 0; i < 4; i++) {
    cells.push(div().w(5).h(9).bg(i < filled ? col : t.border));
  }
  return h_flex().gap(1).items_center().children(cells);
}

function shortPlan(p) {
  if (!p) return "";
  return String(p).replace(/^(google ai|claude|chatgpt)\s+/i, "").trim().toUpperCase();
}

function bucketLabel(key) {
  const map = {
    "gemini-5h": "GEMINI 5H",
    "gemini-weekly": "GEMINI WK",
    "3p-5h": "CLAUDE/GPT 5H",
    "3p-weekly": "CLAUDE/GPT WK",
  };
  return map[key] ?? key.toUpperCase();
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
  return [`-${burn.toFixed(1)}%/h · outlasts reset`, false];
}

function fmtForecastTip(bv, bk) {
  const isWeekly = String(bk || "").includes("weekly");
  const win = isWeekly ? "24h OLS regression" : "90m OLS regression";
  const resetStr = fmtLeft(bv?.reset_in_sec);
  const sp = bv?.spark;
  const burn = bv?.burn_pct_per_h;
  const tail = "Sparkline (right): up to 16 chronological remaining-% samples in this reset cycle.";
  if (typeof burn !== "number" || !Array.isArray(sp) || sp.length < 2) {
    return `Collecting quota trend (${win}) — needs >=2 samples >=60s apart in the current cycle. Resets in ${resetStr}. ${tail}`;
  }
  if (burn < 0.05) {
    return `Stable (<0.05%/h over ${win}). Projected to last until reset (${resetStr}). ${tail}`;
  }
  if (bv.exhausts_before_reset && typeof bv.eta_empty_sec === "number") {
    const warnNote = isWeekly
      ? " Weekly rows turn red only when 0% ETA <= 36h."
      : " Highlighted red when projected to hit 0% before reset.";
    return `Exhaustion forecast (${win}): burning ${burn.toFixed(1)}%/h, hits 0% in ${fmtLeft(bv.eta_empty_sec)} (before reset in ${resetStr}).${warnNote} ${tail}`;
  }
  return `Burn pace (${win}): -${burn.toFixed(1)}%/h — projected to stay above 0% until reset in ${resetStr}. ${tail}`;
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
        return div().w(3).h(h).bg(col || t.muted);
      }),
    );
}

export default class ModulorBar extends View {
  init(_props, cx) {
    if (checking()) return;
    if (props()?.popup) return;
    this.probeSrc = null;
    this.lastSig = {};
    this.lastPushAt = {};
    this.lastWinTitle = null;
    this.spawning = false;
    this.tick = 0;

    cx.spawn(async (cx) => {
      const p = `${appHome().replace(/\\/g, "/")}/mods/modulor-bar/probe.py`;
      this.probeSrc = await readTextFile(p).catch(() => null);
      for (;;) {
        await this.pollAll();
        cx.notify();
        await cx.sleep(POLL_MS);
      }
    });

    cx.spawn(async (cx) => {
      for (;;) {
        const cmd = await nextCommand();
        this.handleCommand(cmd, cx);
        cx.notify();
      }
    });
  }

  handleCommand(cmd, cx) {
    if (!cmd) return;
    if (cmd === "test-alert") {
      notify({
        title: "Modulor Alert Ready",
        body: "Quota, context & stale probe alerts are active",
        level: "info",
      });
      return;
    }
    if (cmd === "next-review") {
      const list = agents();
      const urgent = [
        ...list.filter((a) => a.status === "blocked").sort((a, b) => a.seq - b.seq),
        ...list.filter((a) => a.status === "done").sort((a, b) => b.seq - a.seq),
      ];
      if (urgent.length === 0) {
        run("agent.next");
        return;
      }
      const curIdx = urgent.findIndex((a) => a.focused);
      const next = curIdx >= 0 && urgent.length > 1 ? urgent[(curIdx + 1) % urgent.length] : urgent[0];
      run("agent.focus", { terminal: next.address });
      return;
    }
    if (cmd === "quota") {
      openOverlay({ mod: "modulor-bar", kind: "popup", width: 460, height: 380, props: { popup: "quota" } });
      return;
    }
    if (cmd === "memory") {
      openOverlay({ mod: "modulor-memory", kind: "popup", width: 380, height: 520, props: { popup: true } });
      return;
    }
    if (cmd === "queue") {
      openOverlay({ mod: "modulor-queue", kind: "dialog", width: 320, height: 460, props: { popup: true } });
      return;
    }
    if (cmd === "cost") {
      openOverlay({ mod: "modulor-cost", kind: "dialog", width: 520, height: 440, props: { popup: true } });
      return;
    }
    if (cmd === "blueprints") {
      openOverlay({ mod: "modulor-blueprint", kind: "dialog", width: 620, height: 520 });
      return;
    }
    if (cmd === "planche") {
      const activeSp = spaces().find((s) => s.active);
      const tabIds = new Set((activeSp?.tabs ?? []).map((tb) => tb.id));
      const pPane = panes().find((p) => tabIds.has(p.tab) && p.mod === "modulor-planche");
      if (pPane) {
        run("tab.select", { id: pPane.tab });
      } else {
        run("tab.new", { name: "Planche", mod: "modulor-planche" });
      }
      return;
    }
    if (cmd === "new-board" || cmd === "compose-here" || cmd === "launch-blueprint") {
      if (this.spawning || !cx) return;
      const bpStore = shared("modulor.blueprints") ?? {};
      let spec = null;
      let worktreeIsolate = Boolean(bpStore.worktreeIsolate);
      let inPlace = cmd === "compose-here";
      if (cmd === "launch-blueprint") {
        const req = shared("modulor.launchRequest");
        if (req?.blueprint) {
          spec = req.blueprint;
          worktreeIsolate = Boolean(req.worktreeIsolate);
          inPlace = Boolean(req.inPlace);
        }
      }
      if (!spec) {
        spec = resolvePreset(bpStore.defaultId || "quad-4", bpStore);
      }
      this.spawning = true;
      cx.spawn(async (cx) => {
        try {
          await spawnBlueprint(spec, { worktreeIsolate, inPlace }, cx);
        } finally {
          this.spawning = false;
          cx.notify();
        }
      });
      return;
    }
    if (cmd === "logs") {
      const existing = shared("modulor.logOverlayId");
      if (existing) {
        closeOverlay(existing);
        setShared("modulor.logOverlayId", null);
      } else {
        const oid = openOverlay({ mod: "modulor-log", kind: "window", key: "modulor-log", keep: true, width: 580, height: 380 });
        setShared("modulor.logOverlayId", oid);
      }
      return;
    }
    if (cmd === "logs-close") {
      const existing = shared("modulor.logOverlayId");
      if (existing) {
        closeOverlay(existing);
        setShared("modulor.logOverlayId", null);
      }
      return;
    }
  }

  checkAlerts(store) {
    if (checking()) return;
    const prev = shared(KEY_ALERTS);
    const { fired, next } = evaluateAlerts(store, prev, Date.now());
    if (JSON.stringify(prev ?? null) !== JSON.stringify(next)) {
      setShared(KEY_ALERTS, next);
    }
    for (const a of fired) {
      notify({
        title: a.title,
        body: a.body,
        level: a.level,
        action: a.action,
      });
      if (a.sound) playSound(a.sound);
    }
  }

  async pollMachine(machine) {
    if (!this.probeSrc) return null;
    try {
      const opts = machine ? { on: machine, timeout: 8000 } : { timeout: 8000 };
      const r = await exec("python3", ["-c", this.probeSrc], opts);
      if (r.code !== 0 || !r.stdout) return null;
      return JSON.parse(r.stdout);
    } catch {
      return null;
    }
  }

  async pollAll() {
    if (!this.probeSrc) {
      const p = `${appHome().replace(/\\/g, "/")}/mods/modulor-bar/probe.py`;
      this.probeSrc = await readTextFile(p).catch(() => null);
      if (!this.probeSrc) return;
    }
    const sp = spaces();
    const active = sp.find((s) => s.active);
    const activeMachine = active?.machine ?? null;
    const targets = new Set([activeMachine]);
    if (this.tick % REMOTE_EVERY_TICKS === 0) {
      for (const s of sp) targets.add(s.machine ?? null);
    }
    this.tick += 1;

    const current = { ...(shared(KEY_TELEMETRY) ?? {}) };
    let changed = false;
    const now = Date.now();

    for (const m of targets) {
      const mk = m ?? "__local__";
      const data = await this.pollMachine(m);
      if (!data) continue;
      const sig = JSON.stringify({ ...data, ts: 0 });
      if (this.lastSig[mk] !== sig || now - (this.lastPushAt[mk] ?? 0) >= 10000) {
        this.lastSig[mk] = sig;
        this.lastPushAt[mk] = now;
        current[mk] = data;
        changed = true;
      }
    }
    if (changed) setShared(KEY_TELEMETRY, current);
    this.checkAlerts(current);
  }

  renderQuotaPopup(t) {
    const store = shared(KEY_TELEMETRY) ?? {};
    const activeSpace = spaces().find((s) => s.active);
    const mk = activeSpace?.machine ?? "__local__";
    const tel = store[mk] ?? store.__local__ ?? {};
    const accounts = Object.values(tel.accounts ?? {});
    const foc = focused();
    const fParsed = splitAddr(foc?.terminal);
    const activeEmail = tel.terminals?.[fParsed.id]?.email ?? tel.latest_email;

    accounts.sort((a, b) => {
      if (a.email === activeEmail) return -1;
      if (b.email === activeEmail) return 1;
      return (a.email ?? "").localeCompare(b.email ?? "");
    });

    return v_flex()
      .id("quota-popup")
      .size_full()
      .bg(t.popover)
      .border(1)
      .border_color(t.input)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(34)
          .px(12)
          .items_center()
          .justify_between()
          .bg(t.chrome)
          .border_b(1)
          .border_color(t.border)
          .child(div().text_size(12).font_semibold().child("Antigravity Account Quotas"))
          .child(
            div()
              .id("q-close")
              .px(6)
              .py(2)
              .cursor_pointer()
              .text_size(11)
              .text_color(t.muted)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => closeOverlay(props().overlay))
              .child("ESC"),
          ),
      )
      .child(
        v_flex()
          .id("q-list")
          .flex_1()
          .min_h(0)
          .p(12)
          .gap(12)
          .overflow_y_scrollbar()
          .when(accounts.length === 0, (el) =>
            el.child(
              div()
                .p(10)
                .border(1)
                .border_color(t.border)
                .text_size(12)
                .text_color(t.muted)
                .child("No active Antigravity session detected on this machine yet."),
            ),
          )
          .children(
            accounts.map((acct, ai) => {
              const isCur = acct.email === activeEmail;
              const qEntries = Object.entries(acct.quota ?? {});
              const order = ["gemini-5h", "gemini-weekly", "3p-5h", "3p-weekly"];
              qEntries.sort((a, b) => {
                const ia = order.indexOf(a[0]);
                const ib = order.indexOf(b[0]);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
              });
              return v_flex()
                .id(`acct-${ai}`)
                .border(1)
                .border_color(isCur ? t.foreground : t.border)
                .bg(t.surface)
                .child(
                  h_flex()
                    .px(10)
                    .h(28)
                    .items_center()
                    .justify_between()
                    .bg(isCur ? t.foreground : t.chrome)
                    .text_color(isCur ? t.background : t.foreground)
                    .child(
                      h_flex()
                        .gap(6)
                        .items_center()
                        .child(div().text_size(11.5).font_semibold().child(acct.email))
                        .when(Boolean(acct.plan), (el) =>
                          el.child(
                            div()
                              .px(5)
                              .py(1)
                              .bg(isCur ? "#33312C" : t.raised)
                              .text_size(10)
                              .text_color(isCur ? "#FAF8F4" : t.muted)
                              .child(shortPlan(acct.plan)),
                          ),
                        ),
                    )
                    .child(
                      div()
                        .font_family("Geist Mono")
                        .text_size(10.5)
                        .text_color(isCur ? "#C9C3B6" : t.dim)
                        .child(`${acct.active_panes ?? 0} PANES`),
                    ),
                )
                .when(qEntries.length === 0, (el) =>
                  el.child(
                    div()
                      .p(10)
                      .text_size(11.5)
                      .text_color(t.muted)
                      .child("Account verified from session auth log. Quota buckets populate on the next agy turn."),
                  ),
                )
                .when(qEntries.length > 0, (el) =>
                  el.child(
                    v_flex()
                      .p(10)
                      .gap(8)
                      .children(
                        qEntries.map(([bk, bv]) => {
                          const rem = bv.remaining_pct ?? 0;
                          const col = meterColor(rem, t);
                          const [fcText, fcWarn] = fmtForecast(bv, bk);
                          const spEl = sparkBars(bv.spark, col, t);
                          return v_flex()
                            .id(`qb-bkt-${ai}-${bk}`)
                            .gap(3)
                            .tooltip(fmtForecastTip(bv, bk))
                            .child(
                              h_flex()
                                .justify_between()
                                .items_center()
                                .child(div().text_size(11).font_medium().text_color(t.muted).child(bucketLabel(bk)))
                                .child(
                                  h_flex()
                                    .gap(8)
                                    .items_center()
                                    .child(
                                      div()
                                        .font_family("Geist Mono")
                                        .text_size(11.5)
                                        .font_semibold()
                                        .text_color(col)
                                        .child(`${Math.round(rem)}% left`),
                                    )
                                    .child(
                                      div()
                                        .font_family("Geist Mono")
                                        .text_size(10.5)
                                        .text_color(t.dim)
                                        .child(`reset ${fmtLeft(bv.reset_in_sec)}`),
                                    ),
                                ),
                            )
                            .child(
                              h_flex()
                                .w_full()
                                .h(5)
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
                                    .text_size(9.5)
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
          ),
      );
  }

  render() {
    const t = theme();
    if (props()?.popup === "quota") return this.renderQuotaPopup(t);

    const compact = Boolean(props()?.compact);
    const store = shared(KEY_TELEMETRY) ?? {};
    const activeSpace = spaces().find((s) => s.active);
    const mk = activeSpace?.machine ?? "__local__";
    const tel = store[mk] ?? {};
    const foc = focused();
    const fParsed = splitAddr(foc?.terminal);

    const focusEmail =
      tel.terminals?.[fParsed.id]?.email ??
      (tel.active_emails?.length === 1 ? tel.active_emails[0] : tel.latest_email);
    const acctCount = Object.keys(tel.accounts ?? {}).length;
    const acct = (focusEmail && tel.accounts?.[focusEmail]) || null;
    const quota = acct?.quota ?? null;

    const g5 = quota?.["gemini-5h"];
    const gw = quota?.["gemini-weekly"];
    const c5 = quota?.["3p-5h"];

    const spaceTabIds = new Set((activeSpace?.tabs ?? []).map((tb) => tb.id));
    const spacePanes = panes().filter((p) => spaceTabIds.has(p.tab) && p.terminal);
    let totalCtx = 0;
    let totalOut = 0;
    for (const p of spacePanes) {
      const sp = splitAddr(p.terminal);
      const info = store[sp.machine]?.terminals?.[sp.id];
      if (info?.ctx_tokens) totalCtx += info.ctx_tokens;
      if (info?.out_tokens) totalOut += info.out_tokens;
    }

    const agList = agents();
    const blockedCount = agList.filter((a) => a.status === "blocked").length;
    const doneCount = agList.filter((a) => a.status === "done").length;
    const workingCount = agList.filter((a) => a.status === "working").length;

    if (!checking()) {
      const titleParts = ["MODULOR"];
      if (blockedCount > 0) titleParts.push(`REV ${blockedCount}`);
      if (doneCount > 0) titleParts.push(`NEW ${doneCount}`);
      else if (workingCount > 0 && blockedCount === 0) titleParts.push(`WRK ${workingCount}`);
      if (g5 && typeof g5.remaining_pct === "number") titleParts.push(`G5H ${Math.round(g5.remaining_pct)}%`);
      if (c5 && typeof c5.remaining_pct === "number") titleParts.push(`3P ${Math.round(c5.remaining_pct)}%`);
      if (activeSpace?.name) titleParts.push(activeSpace.name);
      const nextTitle = titleParts.join(" · ");
      if (nextTitle !== this.lastWinTitle) {
        this.lastWinTitle = nextTitle;
        setWindowTitle(nextTitle);
      }
    }

    const panelNode = findNode(layout(), "panel");
    const showMemPill = compact || !panelNode || panelNode.hidden;
    const topAct = (tel.memory?.activations ?? [])[0];
    const todayUsd = tel.usage?.today?.est_usd;
    const logSources = Array.isArray(shared("modulor.logs")) ? shared("modulor.logs").length : 0;
    const acctTag = focusEmail
      ? acctCount > 1
        ? `${focusEmail.split("@")[0]} (${acctCount})`
        : focusEmail.split("@")[0]
      : "agy";

    return h_flex()
      .id("modulor-bar")
      .size_full()
      .px(10)
      .gap(10)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.5)
      .text_color(t.muted)
      .when(compact, (el) => {
        const urgent = blockedCount + doneCount;
        return el.child(
          div()
            .id("bar-queue")
            .px(6)
            .h(18)
            .flex()
            .items_center()
            .bg(urgent > 0 ? t.blocked : t.raised)
            .border(1)
            .border_color(urgent > 0 ? t.blocked : t.border)
            .text_color(urgent > 0 ? "#FAF8F4" : t.foreground)
            .font_family("Geist Mono")
            .text_size(10)
            .font_semibold()
            .cursor_pointer()
            .tooltip("Open Review Queue & Spaces (Cmd+Alt+A)")
            .hover((s) => s.bg(urgent > 0 ? t.blocked : t.hover))
            .on_click(() =>
              openOverlay({
                mod: "modulor-queue",
                kind: "dialog",
                width: 320,
                height: 460,
                props: { popup: true },
              }),
            )
            .child(urgent > 0 ? `QUEUE · ${urgent}!` : `QUEUE ${agList.length}`),
        );
      })
      .child(
        h_flex()
          .id("bar-quota")
          .gap(8)
          .items_center()
          .cursor_pointer()
          .px(4)
          .h(22)
          .hover((s) => s.bg(t.hover))
          .tooltip("Click to inspect multi-account quota burn rate & 0% exhaustion forecast (Cmd+Alt+Q)")
          .on_click(() =>
            openOverlay({
              mod: "modulor-bar",
              kind: "popup",
              width: 460,
              height: 340,
              props: { popup: "quota" },
            }),
          )
          .child(
            div()
              .px(5)
              .h(16)
              .flex()
              .items_center()
              .bg(t.foreground)
              .text_color(t.background)
              .font_family("Geist Mono")
              .text_size(10)
              .font_semibold()
              .child(acctTag),
          )
          .when(!quota, (el) =>
            el.child(
              div()
                .font_family("Geist Mono")
                .text_size(10.5)
                .text_color(t.dim)
                .child("QUOTA PENDING NEXT TURN"),
            ),
          )
          .when(Boolean(g5), (el) =>
            el.child(
              h_flex()
                .gap(5)
                .items_center()
                .child(div().text_size(10.5).font_semibold().text_color(t.muted).child("GEM 5H"))
                .child(meterCells(g5.remaining_pct, t))
                .child(
                  div()
                    .font_family("Geist Mono")
                    .text_size(11)
                    .font_semibold()
                    .text_color(meterColor(g5.remaining_pct, t))
                    .child(`${Math.round(g5.remaining_pct)}%`),
                )
                .child(
                  div()
                    .font_family("Geist Mono")
                    .text_size(10)
                    .text_color(t.dim)
                    .child(fmtLeft(g5.reset_in_sec)),
                ),
            ),
          )
          .when(Boolean(gw) && !compact, (el) =>
            el.child(
              h_flex()
                .gap(4)
                .items_center()
                .pl(4)
                .border_l(1)
                .border_color(t.border)
                .child(div().text_size(10.5).text_color(t.dim).child("WK"))
                .child(
                  div()
                    .font_family("Geist Mono")
                    .text_size(11)
                    .font_medium()
                    .text_color(meterColor(gw.remaining_pct, t))
                    .child(`${Math.round(gw.remaining_pct)}%`),
                ),
            ),
          )
          .when(Boolean(c5), (el) =>
            el.child(
              h_flex()
                .gap(4)
                .items_center()
                .pl(4)
                .border_l(1)
                .border_color(t.border)
                .child(div().text_size(10.5).text_color(t.dim).child("3P 5H"))
                .child(
                  div()
                    .font_family("Geist Mono")
                    .text_size(11)
                    .font_medium()
                    .text_color(meterColor(c5.remaining_pct, t))
                    .child(`${Math.round(c5.remaining_pct)}%`),
                ),
            ),
          ),
      )
      .when(showMemPill, (el) =>
        el.child(
          h_flex()
            .id("bar-mem")
            .gap(6)
            .px(6)
            .h(20)
            .items_center()
            .border_l(1)
            .border_color(t.border)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click(() =>
              openOverlay({
                mod: "modulor-memory",
                kind: "popup",
                width: 360,
                height: 500,
                props: { popup: true },
              }),
            )
            .child(div().text_size(10).font_semibold().text_color(t.done).child("MEM"))
            .child(
              div()
                .max_w(190)
                .truncate()
                .font_family("Geist Mono")
                .text_size(10.5)
                .text_color(t.muted)
                .child(
                  topAct
                    ? `${topAct.terminal} ${topAct.tool}: ${topAct.target || "active"}`
                    : `${(tel.memory?.slots ?? []).length} slots`,
                ),
            ),
        ),
      )
      .child(div().flex_1())
      .when(blockedCount > 0, (el) =>
        el.child(
          div()
            .id("bar-review")
            .px(6)
            .h(18)
            .flex()
            .items_center()
            .bg(t.blocked)
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(10)
            .font_bold()
            .cursor_pointer()
            .on_click(() => run("agent.next"))
            .child(`REVIEW ${blockedCount}`),
        ),
      )
      .when(doneCount > 0, (el) =>
        el.child(
          div()
            .id("bar-unread")
            .px(6)
            .h(18)
            .flex()
            .items_center()
            .bg(t.done)
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(10)
            .font_bold()
            .cursor_pointer()
            .on_click(() => run("agent.next"))
            .child(`UNREAD ${doneCount}`),
        ),
      )
      .child(
        div()
          .font_family("Geist Mono")
          .text_size(11)
          .text_color(t.foreground)
          .child(`CTX ${fmtTok(totalCtx)} · OUT ${fmtTok(totalOut)}`),
      )
      .when(typeof todayUsd === "number", (el) =>
        el.child(
          div()
            .id("bar-cost")
            .px(6)
            .h(18)
            .flex()
            .items_center()
            .bg(t.raised)
            .border(1)
            .border_color(t.border)
            .font_family("Geist Mono")
            .text_size(10)
            .font_semibold()
            .text_color(t.foreground)
            .cursor_pointer()
            .tooltip("Today's API-equivalent usage (Ultra included) · Click or Cmd+Alt+C for 7d ledger")
            .hover((s) => s.bg(t.hover))
            .on_click(() =>
              openOverlay({
                mod: "modulor-cost",
                kind: "dialog",
                width: 520,
                height: 440,
                props: { popup: true },
              }),
            )
            .child(`≈$${todayUsd.toFixed(todayUsd >= 100 ? 0 : 2)}`),
        ),
      )
      .when(!compact || logSources > 0, (el) =>
        el.child(
          div()
            .id("bar-logs")
            .px(5)
            .h(18)
            .flex()
            .items_center()
            .bg(logSources > 0 ? t.surface : t.chrome)
            .border(1)
            .border_color(t.border)
            .font_family("Geist Mono")
            .text_size(9.5)
            .text_color(logSources > 0 ? t.foreground : t.dim)
            .cursor_pointer()
            .tooltip("Open Log Watcher window (Cmd+Alt+L)")
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click(() => {
              const existing = shared("modulor.logOverlayId");
              if (existing) {
                closeOverlay(existing);
                setShared("modulor.logOverlayId", null);
              } else {
                const oid = openOverlay({
                  mod: "modulor-log",
                  kind: "window",
                  key: "modulor-log",
                  keep: true,
                  width: 580,
                  height: 380,
                });
                setShared("modulor.logOverlayId", oid);
              }
            })
            .child(logSources > 0 ? `LOG ${logSources}` : "LOG"),
        ),
      )
      .child(
        div()
          .pl(8)
          .border_l(1)
          .border_color(t.border)
          .font_family("Geist Mono")
          .text_size(10.5)
          .text_color(t.dim)
          .child(activeSpace?.machine ? `SSH ${activeSpace.machine.toUpperCase()}` : "LOCAL"),
      );
  }
}
