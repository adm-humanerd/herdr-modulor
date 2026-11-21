import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  agents,
  terminals,
  spaces,
  machines,
  layout,
  theme,
  shared,
  setShared,
  setAgentOrder,
  setBadge,
  run,
  window,
  checking,
  openOverlay,
  props,
} from "herdr";

const KEY_TELEMETRY = "modulor.telemetry";
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

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

function toggleRail() {
  const curW = findNode(layout(), "sidebar")?.size?.px;
  const narrowing = !isNarrow();
  if (narrowing) {
    if (typeof curW === "number") setShared("modulor.sidebarWidth", curW);
    run("layout.hide", { id: "sidebar-quota" });
    run("layout.hide", { id: "sidebar-spaces" });
    run("layout.resize", { id: "sidebar", px: window()?.platform === "macos" ? 78 : 54 });
  } else {
    run("layout.show", { id: "sidebar-quota" });
    run("layout.show", { id: "sidebar-spaces" });
    run("layout.resize", { id: "sidebar", px: shared("modulor.sidebarWidth") ?? 272 });
  }
}

function splitAddr(addr) {
  if (!addr) return { machine: "__local__", id: "" };
  const idx = addr.indexOf("/");
  if (idx > 0) return { machine: addr.slice(0, idx), id: addr.slice(idx + 1) };
  return { machine: "__local__", id: addr };
}

function fmtTok(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n <= 0) return "";
  if (n < 1000) return String(Math.round(n));
  if (n < 999500) return `${Math.round(n / 1000)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

const clean = (s) =>
  (s ?? "")
    .replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "")
    .replace(/^\[ [!.] \] /, "")
    .trim();

export default class ModulorQueue extends View {
  init(_props, cx) {
    this.lastBadge = undefined;
    try {
      this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
      if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    } catch {
      this.changed = {};
    }
    if (checking()) return;
    if (props()?.section !== "spaces") {
      cx.timer.every(30000, (cx) => cx.notify());
    }
  }

  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const live = new Set(list.map((a) => a.address));
    for (const [k, v] of Object.entries(this.changed)) {
      if (!live.has(k) && now - v.at > 30 * 86400000) delete this.changed[k];
    }
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  subAgents(all, addr) {
    return all.filter((x) => x.parent === addr && x.state === "live");
  }

  renderSpaces(t) {
    if (isNarrow()) return div();
    const spList = spaces();
    const connectedRemotes = machines().filter((m) => m.name !== null).length;

    const spaceRows = spList.map((s) => {
      const mLabel = s.machine ? s.machine : "local";
      const stColor = s.status === "blocked" ? t.blocked : s.status === "done" ? t.done : null;
      return h_flex()
        .id(`msp-${s.id}`)
        .h(28)
        .px(10)
        .gap(6)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .bg(s.active ? t.selected : t.chrome)
        .cursor_pointer()
        .hover((el) => el.bg(s.active ? t.selected : t.hover))
        .on_click(() => run("space.select", { id: s.id }))
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "menu", kind: "popup", width: 200, height: 220, props: { tab: "space", target: { id: s.id } } });
        })
        .when(Boolean(stColor), (el) => el.child(div().w(6).h(6).flex_none().bg(stColor)))
        .when(!stColor, (el) => el.child(div().w(6).h(6).flex_none().border(1).border_color(t.input)))
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_size(11.5)
            .font_medium()
            .text_color(s.active ? t.foreground : t.muted)
            .child(s.name),
        )
        .when(Boolean(s.branch), (el) =>
          el.child(
            h_flex()
              .gap(3)
              .max_w(72)
              .items_center()
              .child(svg("mods/modulor-bar/icons/branch.svg").size(10).flex_none().text_color(t.dim))
              .child(div().truncate().font_family("Geist Mono").text_size(10).text_color(t.dim).child(s.branch)),
          ),
        )
        .when(Boolean(s.machine), (el) =>
          el.child(
            div()
              .px(4)
              .bg(t.raised)
              .font_family("Geist Mono")
              .text_size(9.5)
              .text_color(t.muted)
              .child(mLabel),
          ),
        );
    });

    return v_flex()
      .id("modulor-spaces")
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
          .border_b(1)
          .border_color(t.border)
          .bg(t.raised)
          .child(
            div()
              .text_size(11)
              .font_semibold()
              .text_color(t.foreground)
              .child(connectedRemotes > 0 ? `Spaces · ${connectedRemotes} SSH` : "Spaces"),
          )
          .child(
            div()
              .id("mq-new-space")
              .p(3)
              .cursor_pointer()
              .text_color(t.muted)
              .tooltip("New Space (Cmd+N)")
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => run("space.new"))
              .child(svg("mods/modulor-bar/icons/plus.svg").size(12)),
          ),
      )
      .child(
        v_flex()
          .id("mq-spaces-scroll")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .children(spaceRows),
      );
  }

  render() {
    const t = theme();
    const section = props()?.section;
    if (section === "spaces") return this.renderSpaces(t);

    const w = window();
    const collapsed = isNarrow();
    const listRaw = agents();
    const allTerms = terminals();
    const telStore = shared(KEY_TELEMETRY) ?? {};
    const now = Date.now();
    this.track(listRaw, now);

    const sorted = [...listRaw].sort((a, b) => {
      const ra = RANK[a.status] ?? 0;
      const rb = RANK[b.status] ?? 0;
      if (rb !== ra) return rb - ra;
      if (a.status === "blocked") return this.since(a) - this.since(b);
      return this.since(b) - this.since(a) || b.seq - a.seq;
    });
    setAgentOrder(sorted.map((a) => a.address));

    const urgentCount = sorted.filter((a) => a.status === "blocked" || a.status === "done").length;
    const badgeStr = urgentCount > 0 ? String(urgentCount) : null;
    if (badgeStr !== this.lastBadge) {
      this.lastBadge = badgeStr;
      if (!checking()) setBadge(badgeStr);
    }

    const macLights = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen;

    const tagFor = (status, focused) => {
      if (status === "blocked") {
        return div()
          .px(4)
          .h(16)
          .flex()
          .items_center()
          .bg(t.blocked)
          .text_color("#FAF8F4")
          .font_family("Geist Mono")
          .text_size(9.5)
          .font_bold()
          .when(!focused, (b) => b.loop("opacity", { from: 0.62, to: 1, period: 1600 }))
          .child("REV");
      }
      if (status === "done") {
        return div()
          .px(4)
          .h(16)
          .flex()
          .items_center()
          .bg(t.done)
          .text_color("#FAF8F4")
          .font_family("Geist Mono")
          .text_size(9.5)
          .font_bold()
          .child("NEW");
      }
      if (status === "working") {
        return div()
          .px(4)
          .h(16)
          .flex()
          .items_center()
          .bg(t.working)
          .text_color("#FAF8F4")
          .font_family("Geist Mono")
          .text_size(9.5)
          .font_bold()
          .child("WRK");
      }
      return div()
        .px(4)
        .h(16)
        .flex()
        .items_center()
        .border(1)
        .border_color(focused ? "#4A4741" : t.border)
        .text_color(focused ? "#C9C3B6" : t.dim)
        .font_family("Geist Mono")
        .text_size(9.5)
        .child("IDL");
    };

    const queueRows = sorted.flatMap((a, idx) => {
      const sp = splitAddr(a.address);
      const info = telStore[sp.machine]?.terminals?.[sp.id];
      const subs = collapsed ? [] : this.subAgents(allTerms, a.address);
      const ctxStr = fmtTok(info?.ctx_tokens);
      const dur = this.since(a) ? fmtDur(now - this.since(a)) : "";
      const rowTitle = info?.title || clean(a.title) || a.tab_name || sp.id;

      if (collapsed) {
        return [
          h_flex()
            .id(`mq-${a.address}`)
            .h(30)
            .px(8)
            .gap(6)
            .items_center()
            .justify_between()
            .border_b(1)
            .border_color(t.border)
            .bg(a.focused ? "#191816" : t.chrome)
            .cursor_pointer()
            .hover((s) => s.bg(a.focused ? "#191816" : t.hover))
            .tooltip(`${rowTitle} (${a.status})`)
            .on_click(() => run("agent.focus", { terminal: a.address }))
            .child(
              div()
                .font_family("Geist Mono")
                .text_size(11)
                .font_bold()
                .text_color(a.focused ? "#FAF8F4" : t.foreground)
                .child(String(idx + 1)),
            )
            .child(tagFor(a.status, a.focused)),
        ];
      }

      const mainRow = h_flex()
        .id(`mq-${a.address}`)
        .px(10)
        .py(7)
        .gap(8)
        .items_start()
        .border_b(1)
        .border_color(a.focused ? "#191816" : t.border)
        .bg(
          a.focused
            ? "#191816"
            : a.status === "blocked"
              ? "#F5E6E3"
              : a.status === "done"
                ? "#E6EEF5"
                : t.chrome,
        )
        .cursor_pointer()
        .hover((s) => s.bg(a.focused ? "#191816" : t.hover))
        .on_click(() => run("agent.focus", { terminal: a.address }))
        .child(
          v_flex()
            .gap(3)
            .items_start()
            .flex_none()
            .child(tagFor(a.status, a.focused))
            .child(
              div()
                .font_family("Geist Mono")
                .text_size(10)
                .text_color(a.focused ? "#C9C3B6" : t.dim)
                .child(`#${idx + 1} ${sp.id}`),
            ),
        )
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(
              div()
                .truncate()
                .text_size(12)
                .font_medium()
                .text_color(a.focused ? "#FAF8F4" : a.status === "idle" ? t.muted : t.foreground)
                .child(rowTitle),
            )
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .font_family("Geist Mono")
                .text_size(10)
                .text_color(a.focused ? "#C9C3B6" : t.dim)
                .child(a.space_name || "~")
                .when(Boolean(dur), (el) => el.child(`· ${dur}`))
                .when(Boolean(ctxStr), (el) => el.child(`· ${ctxStr}`)),
            ),
        );

      const subRows = subs.map((k) =>
        h_flex()
          .id(`mq-sub-${k.address}`)
          .h(24)
          .pl(24)
          .pr(10)
          .gap(6)
          .items_center()
          .bg(t.raised)
          .border_b(1)
          .border_color(t.border)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("terminal.peek", { terminal: k.address }))
          .child(div().w(6).h(6).bg(t[k.status] ?? t.dim))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(11)
              .text_color(t.muted)
              .child(k.name || k.template || k.address),
          ),
      );

      return [mainRow, ...subRows];
    });

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .pl(macLights ? (collapsed ? 10 : 78) : 10)
          .pr(8)
          .items_center()
          .justify_between()
          .border_b(1)
          .border_color(t.border)
          .when(!collapsed, (el) =>
            el
              .child(div().text_size(11.5).font_semibold().text_color(t.foreground).child("MODULOR"))
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(
                    div()
                      .id("mq-switch-13")
                      .px(5)
                      .h(20)
                      .flex()
                      .items_center()
                      .border(1)
                      .border_color(t.border)
                      .bg(t.surface)
                      .font_family("Geist Mono")
                      .text_size(10)
                      .text_color(t.muted)
                      .cursor_pointer()
                      .tooltip("Switch to 13-inch Air focus layout (Cmd+Shift+9)")
                      .hover((s) => s.bg(t.foreground).text_color(t.background))
                      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                      .on_click(() => run("layout.switch", { name: "modulor-13" }))
                      .child("13\""),
                  )
                  .child(
                    div()
                      .id("mq-collapse")
                      .p(3)
                      .cursor_pointer()
                      .text_color(t.muted)
                      .tooltip("Collapse rail")
                      .hover((s) => s.bg(t.hover).text_color(t.foreground))
                      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                      .on_click(toggleRail)
                      .child(svg("mods/modulor-bar/icons/sidebar.svg").size(14)),
                  ),
              ),
          )
          .when(collapsed, (el) =>
            el.child(div().flex_1()).child(
              div()
                .id("mq-expand")
                .p(3)
                .cursor_pointer()
                .text_color(t.muted)
                .tooltip("Expand rail")
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                .on_click(toggleRail)
                .child(svg("mods/modulor-bar/icons/sidebar.svg").size(14)),
            ),
          ),
      )
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .h(26)
            .px(10)
            .flex_none()
            .items_center()
            .justify_between()
            .border_b(1)
            .border_color(t.border)
            .bg(t.raised)
            .child(div().text_size(11).font_semibold().text_color(t.foreground).child("Review Queue"))
            .child(
              div()
                .font_family("Geist Mono")
                .text_size(10)
                .text_color(urgentCount > 0 ? t.blocked : t.dim)
                .child(urgentCount > 0 ? `${urgentCount} WAIT` : `${sorted.length}`),
            ),
        ),
      )
      .child(
        v_flex()
          .id("mq-queue-scroll")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .when(queueRows.length === 0 && !collapsed, (el) =>
            el.child(div().p(12).text_size(11.5).text_color(t.dim).child("No active agents.")),
          )
          .children(queueRows),
      )
      .when(!section && !collapsed, (el) => el.child(div().h(160).flex_none().border_t(1).border_color(t.border).child(this.renderSpaces(t))));
  }
}
