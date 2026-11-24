import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import {
  spaces,
  agents,
  panes,
  layout,
  theme,
  shared,
  window,
  props,
  run,
  openOverlay,
  closeOverlay,
  checking,
} from "herdr";

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

const clean = (s) =>
  (s ?? "")
    .replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "")
    .replace(/^\[ [!.] \] /, "")
    .trim();

const BP_SHORTS = {
  "quad-4": "Quad",
  "quad-3p1": "3+1",
  "triptych-3": "3-Col",
  "unite-1p2": "Unité",
  "hex-6": "6-Grid",
};

function defaultBoardLabel() {
  const st = shared("modulor.blueprints");
  const id = st?.defaultId || "quad-4";
  const custom = (st?.custom ?? []).find((c) => c.id === id);
  if (custom) return custom.short || custom.name?.slice(0, 8) || "Board";
  return BP_SHORTS[id] || "Quad";
}

function agentCmdFromName(name) {
  if (!name) return null;
  const low = String(name).trim().toLowerCase();
  if (/antigravity|\bagy\b/.test(low)) return ["agy"];
  if (/claude/.test(low)) return ["claude"];
  if (/codex/.test(low)) return ["codex"];
  if (/gemini/.test(low)) return ["gemini"];
  if (/opencode/.test(low)) return ["opencode"];
  if (low === "pi") return ["pi"];
  return null;
}

function preferredAgentArgv(space, allPanes) {
  const spaceTabs = new Set((space?.tabs ?? []).map((tb) => tb.id));
  const candidates = [
    ...allPanes.filter((p) => p.focused),
    ...allPanes.filter((p) => spaceTabs.has(p.tab)),
    ...allPanes,
  ];
  for (const p of candidates) {
    if (!p?.program?.agent) continue;
    const argv = agentCmdFromName(p.program.name);
    if (argv) return argv;
  }
  return ["agy"];
}

export default class ModulorStrip extends View {
  init() {
    this.scroll = ScrollHandle.new();
    this.pressed = null;
    this.tiling = false;
    if (checking()) return;
  }

  tileHiddenAgents(hiddenAgents, activePaneCount, cx) {
    if (this.tiling || !hiddenAgents.length) return;
    this.tiling = true;
    cx.spawn(async (cx) => {
      try {
        let count = activePaneCount;
        for (const a of hiddenAgents) {
          run("terminal.park", { terminal: a.address });
          await cx.sleep(220);
          const place = count % 2 === 1 ? "right" : "down";
          run("terminal.keep", { terminal: a.address, place });
          count += 1;
          await cx.sleep(260);
        }
      } finally {
        this.tiling = false;
        cx.notify();
      }
    });
  }

  renderSpacesPopup(t) {
    const spList = spaces();
    return v_flex()
      .id("m-spaces-pop")
      .size_full()
      .bg(t.popover)
      .border(1)
      .border_color(t.input)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(32)
          .px(10)
          .items_center()
          .justify_between()
          .bg(t.chrome)
          .border_b(1)
          .border_color(t.border)
          .child(div().text_size(11.5).font_semibold().child("Spaces"))
          .child(
            div()
              .id("msp-new")
              .px(6)
              .py(2)
              .border(1)
              .border_color(t.border)
              .bg(t.surface)
              .text_size(10.5)
              .cursor_pointer()
              .hover((s) => s.bg(t.foreground).text_color(t.background))
              .on_click(() => {
                closeOverlay(props().overlay);
                run("space.new");
              })
              .child("+ New"),
          ),
      )
      .child(
        v_flex()
          .id("msp-pop-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .children(
            spList.map((s) =>
              h_flex()
                .id(`pop-sp-${s.id}`)
                .h(32)
                .px(10)
                .gap(8)
                .items_center()
                .justify_between()
                .border_b(1)
                .border_color(t.border)
                .bg(s.active ? t.selected : t.surface)
                .cursor_pointer()
                .hover((el) => el.bg(t.hover))
                .on_click(() => {
                  closeOverlay(props().overlay);
                  run("space.select", { id: s.id });
                })
                .child(
                  h_flex()
                    .flex_1()
                    .min_w(0)
                    .gap(6)
                    .items_center()
                    .when(s.status === "blocked" || s.status === "done", (el) =>
                      el.child(div().w(6).h(6).bg(t[s.status])),
                    )
                    .child(div().truncate().text_size(12).font_medium().child(s.name)),
                )
                .child(
                  div()
                    .font_family("Geist Mono")
                    .text_size(10)
                    .text_color(t.dim)
                    .child(s.machine ?? s.branch ?? "local"),
                ),
            ),
          ),
      );
  }

  renderFocusStrip(t) {
    const w = window();
    const root = layout();
    const macLights =
      w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
        ? Math.max(76, root.traffic_lights[0] + 66)
        : 10;

    const space = spaces().find((s) => s.active);
    const allAgents = agents();
    const inSpace = space ? allAgents.filter((a) => a.space === space.id) : allAgents;
    const list = inSpace.length ? inSpace : allAgents;
    const telStore = shared(KEY_TELEMETRY) ?? {};
    const agentArgv = preferredAgentArgv(space, panes());
    const stop = (_e, cx) => cx.stop_propagation();

    const cells = list.map((a, idx) => {
      const sp = splitAddr(a.address);
      const info = telStore[sp.machine]?.terminals?.[sp.id];
      const tok = fmtTok(info?.ctx_tokens);
      const title = info?.title || clean(a.title) || a.tab_name || sp.id;
      const isFoc = Boolean(a.focused);
      const st = a.status;

      let bg = t.chrome;
      let fg = t.muted;
      if (isFoc) {
        bg = "#191816";
        fg = "#FAF8F4";
      } else if (st === "blocked") {
        bg = "#F5E6E3";
        fg = t.foreground;
      } else if (st === "done") {
        bg = "#E6EEF5";
        fg = t.foreground;
      }

      return h_flex()
        .id(`fs-${a.address}`)
        .h_full()
        .px(9)
        .gap(6)
        .flex_none()
        .items_center()
        .bg(bg)
        .border_r(1)
        .border_color(t.border)
        .cursor_pointer()
        .hover((s) => s.bg(isFoc ? "#191816" : t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => run("agent.focus", { terminal: a.address }))
        .child(
          div()
            .font_family("Geist Mono")
            .text_size(10.5)
            .font_bold()
            .text_color(isFoc ? "#FAF8F4" : t.foreground)
            .child(String(idx + 1)),
        )
        .when(st === "blocked", (el) =>
          el.child(
            div()
              .px(4)
              .h(15)
              .flex()
              .items_center()
              .bg(t.blocked)
              .text_color("#FAF8F4")
              .font_family("Geist Mono")
              .text_size(9)
              .font_bold()
              .when(!isFoc, (b) => b.loop("opacity", { from: 0.62, to: 1, period: 1600 }))
              .child("REV"),
          ),
        )
        .when(st === "done", (el) =>
          el.child(
            div()
              .px(4)
              .h(15)
              .flex()
              .items_center()
              .bg(t.done)
              .text_color("#FAF8F4")
              .font_family("Geist Mono")
              .text_size(9)
              .font_bold()
              .child("NEW"),
          ),
        )
        .when(st === "working" && !isFoc, (el) =>
          el.child(div().w(6).h(6).flex_none().bg(t.working)),
        )
        .child(
          div()
            .max_w(136)
            .truncate()
            .text_size(11.5)
            .font_medium()
            .text_color(fg)
            .child(title),
        )
        .when(Boolean(tok), (el) =>
          el.child(
            div()
              .font_family("Geist Mono")
              .text_size(10)
              .text_color(isFoc ? "#C9C3B6" : t.dim)
              .child(tok),
          ),
        );
    });

    const toolBtn = (id, label, onClick, tip) =>
      h_flex()
        .id(id)
        .h(24)
        .px(7)
        .flex_none()
        .items_center()
        .border(1)
        .border_color(t.border)
        .bg(t.surface)
        .text_size(10.5)
        .font_medium()
        .text_color(t.foreground)
        .cursor_pointer()
        .tooltip(tip)
        .hover((s) => s.bg(t.foreground).text_color(t.background))
        .on_mouse_down("left", stop)
        .on_click(onClick)
        .child(label);

    return h_flex()
      .size_full()
      .min_w(0)
      .pl(macLights)
      .pr(8)
      .gap(6)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("fs-scroll")
          .flex_1()
          .min_w(0)
          .h_full()
          .items_center()
          .overflow_x_scrollbar()
          .track_scroll(this.scroll)
          .children(cells),
      )
      .child(toolBtn("fs-new", `+ ${agentArgv[0]}`, () => run("tab.new", { argv: agentArgv }), "New agent tab"))
      .child(toolBtn("fs-planche", "Planche", () => run("modulor-bar.planche"), "Open Planche command desk (Cmd+Alt+P)"))
      .child(toolBtn("fs-bp", "Blueprints", () => run("modulor-bar.blueprints"), "Open board blueprints (Cmd+Alt+B)"))
      .child(
        toolBtn(
          "fs-spaces",
          space?.name ? `SP · ${space.name.slice(0, 10)}` : "Spaces",
          () =>
            openOverlay({
              mod: "modulor-strip",
              kind: "popup",
              width: 280,
              height: 340,
              props: { popup: "spaces" },
            }),
          "Switch space",
        ),
      )
      .child(
        toolBtn(
          "fs-mem",
          "Memory",
          () =>
            openOverlay({
              mod: "modulor-memory",
              kind: "popup",
              width: 360,
              height: 500,
              props: { popup: true },
            }),
          "Memory Radar",
        ),
      )
      .child(
        toolBtn(
          "fs-27",
          "27\"",
          () => run("layout.switch", { name: "modulor-27" }),
          "Switch to 27-inch all-panels wall (Cmd+Shift+0)",
        ),
      );
  }

  render() {
    const t = theme();
    if (props()?.popup === "spaces") return this.renderSpacesPopup(t);
    if (props()?.mode === "focus-strip") return this.renderFocusStrip(t);

    const space = spaces().find((s) => s.active);
    const tabs = space?.tabs ?? [];
    const activeTab = tabs.find((tb) => tb.active);
    const activeIdx = tabs.findIndex((tb) => tb.active);
    const allPanes = panes();
    const activeTabPanes = activeTab ? allPanes.filter((p) => p.tab === activeTab.id) : [];
    const spaceAgents = space ? agents().filter((a) => a.space === space.id) : [];
    const hiddenAgents = activeTab ? spaceAgents.filter((a) => a.tab !== activeTab.id) : [];
    const agentArgv = preferredAgentArgv(space, allPanes);
    const isBlankShellTab =
      activeTabPanes.length === 1 && !activeTabPanes[0].program?.agent && !activeTabPanes[0].mod;
    const boardLbl = defaultBoardLabel();
    const stop = (_e, cx) => cx.stop_propagation();

    const root = layout();
    const panel = findNode(root, "panel");
    const quotaNode = findNode(root, "sidebar-quota");
    const memNode = findNode(root, "deck-memory");
    const swarmNode = findNode(root, "deck-swarm");
    const gitNode = findNode(root, "deck-git");
    const sidebar = findNode(root, "sidebar");

    const toggleBlockBtn = (id, node, label, inPanel) => {
      const on = Boolean(node && !node.hidden && (!inPanel || (panel && !panel.hidden)));
      return h_flex()
        .id(`ms-tgl-${id}`)
        .h(24)
        .px(8)
        .flex_none()
        .items_center()
        .border(1)
        .border_color(on ? t.foreground : t.border)
        .bg(on ? t.foreground : t.surface)
        .text_size(10.5)
        .font_medium()
        .text_color(on ? t.background : t.foreground)
        .cursor_pointer()
        .hover((s) => s.bg(on ? t.foreground : t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => {
          if (inPanel && panel?.hidden) {
            run("layout.show", { id: "panel" });
            run("layout.show", { id });
          } else if (id === "sidebar-quota" && (sidebar?.size?.px ?? 272) < 160) {
            run("layout.resize", { id: "sidebar", px: 272 });
            run("layout.show", { id: "sidebar-quota" });
            run("layout.show", { id: "sidebar-spaces" });
          } else {
            run("layout.toggle", { id });
          }
        })
        .child(label);
    };

    const tabItems = tabs.map((tb, i) => {
      const tPanes = allPanes.filter((p) => p.tab === tb.id);
      const lead = tPanes.find((p) => p.program?.agent) ?? tPanes[0];
      const title = tb.named ? tb.name : clean(lead?.title) || lead?.program?.name || `Board ${tb.index}`;
      const isAct = tb.active;
      return h_flex()
        .id(`mtab-${tb.id}`)
        .h_full()
        .px(11)
        .gap(7)
        .flex_none()
        .items_center()
        .bg(isAct ? t.background : t.chrome)
        .border_r(1)
        .border_color(t.border)
        .when(isAct, (el) => el.border_t(2).border_color(t.foreground))
        .text_size(12)
        .text_color(isAct ? t.foreground : t.muted)
        .cursor_pointer()
        .hover((s) => s.bg(isAct ? t.background : t.hover))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          this.pressed = i;
          if (e.click_count === 2) run("tab.rename", { id: tb.id });
        })
        .on_mouse_up("left", () => {
          const from = this.pressed;
          this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: tabs[from].id, index: tb.index });
          else run("tab.select", { id: tb.id });
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({
            mod: "menu",
            kind: "popup",
            width: 200,
            props: { tab: "tab", target: { id: tb.id, space: space.id } },
          });
        })
        .when(tb.status === "blocked" || tb.status === "done", (el) =>
          el.child(div().w(6).h(6).flex_none().bg(t[tb.status])),
        )
        .when(tb.status === "working", (el) =>
          el.child(div().w(6).h(6).flex_none().bg(t.working)),
        )
        .child(div().max_w(160).truncate().font_medium().child(title))
        .when(tPanes.length > 1, (el) =>
          el.child(div().font_family("Geist Mono").text_size(10).text_color(t.dim).child(`${tPanes.length}P`)),
        )
        .when(isAct && tabs.length > 1, (el) =>
          el.child(
            div()
              .id(`mtab-x-${tb.id}`)
              .p(2)
              .text_color(t.dim)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_mouse_down("left", stop)
              .on_click((_e, cx) => {
                cx.stop_propagation();
                run("tab.close", { id: tb.id });
              })
              .child(svg("mods/modulor-bar/icons/close.svg").size(10)),
          ),
        );
    });

    return h_flex()
      .size_full()
      .min_w(0)
      .pr(8)
      .gap(6)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .on_mouse_up("left", () => {
        this.pressed = null;
      })
      .child(
        h_flex()
          .id("ms-tabs-scroll")
          .flex_1()
          .min_w(0)
          .h_full()
          .items_center()
          .overflow_x_scrollbar()
          .track_scroll(this.scroll)
          .on_size_change((_sz, cx) => {
            if (activeIdx >= 0) {
              this.scroll.scroll_to_item(activeIdx);
              cx.notify();
            }
          })
          .children(tabItems),
      )
      .when(Boolean(activeTab?.zoomed), (el) =>
        el.child(
          h_flex()
            .id("ms-unzoom")
            .h(24)
            .px(8)
            .flex_none()
            .items_center()
            .bg(t.blocked)
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(10)
            .font_bold()
            .cursor_pointer()
            .on_mouse_down("left", stop)
            .on_click(() => run("pane.zoom"))
            .child("SHOW ALL PANELS"),
        ),
      )
      .when(hiddenAgents.length > 0, (el) =>
        el.child(
          h_flex()
            .id("ms-tile-all")
            .h(24)
            .px(8)
            .flex_none()
            .items_center()
            .bg(t.done)
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(10)
            .font_bold()
            .cursor_pointer()
            .tooltip("Bring agents from background tabs onto this grid")
            .on_mouse_down("left", stop)
            .on_click((_e, cx) => this.tileHiddenAgents(hiddenAgents, activeTabPanes.length, cx))
            .child(`TILE ALL (${spaceAgents.length})`),
        ),
      )
      .when(isBlankShellTab, (el) =>
        el.child(
          h_flex()
            .id("ms-compose-here")
            .h(24)
            .px(8)
            .flex_none()
            .items_center()
            .bg("#191816")
            .text_color("#FAF8F4")
            .font_family("Geist Mono")
            .text_size(10)
            .font_bold()
            .cursor_pointer()
            .tooltip(`Convert this blank shell into ${boardLbl} multi-agent grid`)
            .hover((s) => s.bg(t.done))
            .on_mouse_down("left", stop)
            .on_click(() => run("modulor-bar.compose-here"))
            .child(`Compose ${boardLbl}`),
        ),
      )
      .child(
        h_flex()
          .id("ms-planche")
          .h(24)
          .px(7)
          .flex_none()
          .items_center()
          .border(1)
          .border_color(t.border)
          .bg(t.surface)
          .text_size(10.5)
          .font_medium()
          .text_color(t.foreground)
          .cursor_pointer()
          .tooltip("Open Planche Wall / Docs / Ports tab (Cmd+Alt+P)")
          .hover((s) => s.bg(t.hover))
          .on_mouse_down("left", stop)
          .on_click(() => run("modulor-bar.planche"))
          .child("Planche"),
      )
      .child(
        h_flex()
          .id("ms-blueprints")
          .h(24)
          .px(7)
          .flex_none()
          .items_center()
          .border(1)
          .border_color(t.border)
          .bg(t.surface)
          .text_size(10.5)
          .font_medium()
          .text_color(t.foreground)
          .cursor_pointer()
          .tooltip("Board Blueprints & Save Current Grid (Cmd+Alt+B)")
          .hover((s) => s.bg(t.hover))
          .on_mouse_down("left", stop)
          .on_click(() => run("modulor-bar.blueprints"))
          .child("Blueprints"),
      )
      .child(
        h_flex()
          .id("ms-new-board")
          .h(24)
          .px(8)
          .gap(4)
          .flex_none()
          .items_center()
          .border(1)
          .border_color(t.foreground)
          .bg("#191816")
          .text_size(10.5)
          .font_semibold()
          .text_color("#FAF8F4")
          .cursor_pointer()
          .tooltip(`Open new ${boardLbl} multi-agent board (Cmd+Alt+N)`)
          .hover((s) => s.bg(t.done).border_color(t.done))
          .on_mouse_down("left", stop)
          .on_click(() => run("modulor-bar.new-board"))
          .child(svg("mods/modulor-bar/icons/plus.svg").size(10))
          .child(boardLbl),
      )
      .child(
        h_flex()
          .id("ms-split-agy")
          .h(24)
          .px(8)
          .gap(4)
          .flex_none()
          .items_center()
          .border(1)
          .border_color(t.foreground)
          .bg(t.surface)
          .text_size(10.5)
          .font_semibold()
          .text_color(t.foreground)
          .cursor_pointer()
          .tooltip("Split a new agent directly into this board")
          .hover((s) => s.bg(t.foreground).text_color(t.background))
          .on_mouse_down("left", stop)
          .on_click(() => {
            if (activeTabPanes.length === 0) run("tab.new", { argv: agentArgv });
            else {
              const dir = activeTabPanes.length % 2 === 1 ? "right" : "down";
              run("pane.split", { direction: dir, argv: agentArgv });
            }
          })
          .child(svg("mods/modulor-bar/icons/plus.svg").size(10))
          .child("Panel"),
      )
      .child(
        h_flex()
          .id("ms-new-tab")
          .h(24)
          .px(7)
          .flex_none()
          .items_center()
          .border(1)
          .border_color(t.border)
          .bg(t.surface)
          .text_size(10.5)
          .text_color(t.muted)
          .cursor_pointer()
          .tooltip(`Left-click: New ${agentArgv[0]} tab · Right-click: All programs`)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click(() => run("tab.new", { argv: agentArgv }))
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation();
            openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 });
          })
          .child("+ Tab"),
      )
      .child(toggleBlockBtn("sidebar-quota", quotaNode, "Quota", false))
      .child(toggleBlockBtn("deck-memory", memNode, "Memory", true))
      .when(Boolean(swarmNode), (el) => el.child(toggleBlockBtn("deck-swarm", swarmNode, "Swarm", true)))
      .child(toggleBlockBtn("deck-git", gitNode, "Git", true));
  }
}
