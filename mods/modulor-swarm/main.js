import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  spaces,
  panes,
  focused,
  terminals,
  theme,
  shared,
  props,
  run,
  exec,
  home,
  notify,
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

function shortModel(name) {
  if (!name) return "";
  return String(name)
    .replace(/^models\//, "")
    .replace(/gemini-flash-worker-agy/i, "Flash")
    .replace(/gemini-pro-orchestrator/i, "Orch")
    .replace(/^claude-/i, "")
    .replace(/^gemini-/i, "G")
    .replace(/-preview$/i, "")
    .slice(0, 14);
}

export default class ModulorSwarm extends View {
  init() {
    if (checking()) return;
  }

  openSubagentBrain(cid, machine, cx) {
    if (!cid || checking()) return;
    if (machine && machine !== "__local__") {
      cx?.write_to_clipboard?.(cid);
      notify({ title: "Subagent CID copied", body: cid, level: "info" });
      return;
    }
    const dir = `${home().replace(/\\/g, "/")}/.gemini/antigravity-cli/brain/${cid}`;
    exec("open", [dir]).catch(() => {
      cx?.write_to_clipboard?.(cid);
      notify({ title: "Subagent CID copied", body: cid, level: "info" });
    });
  }

  render() {
    const t = theme();
    const store = shared(KEY_TELEMETRY) ?? {};
    const f = focused();
    const activeSpace = spaces().find((s) => s.active);
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const focusAddr = f?.terminal || pane?.terminal || null;
    const sp = splitAddr(focusAddr);
    const mk = sp.id ? sp.machine : activeSpace?.machine ?? "__local__";
    const tel = store[mk] ?? store.__local__ ?? {};
    const term = sp.id ? tel.terminals?.[sp.id] ?? null : null;

    const agySubs = term?.subagents ?? [];
    const hcKids = focusAddr
      ? terminals().filter((x) => x.parent === focusAddr && x.state === "live")
      : [];

    const nodes = [
      ...hcKids.map((k) => ({
        id: `hc-${k.address}`,
        source: "hc",
        role: k.name || k.template || k.address,
        type: "TERM",
        model: "",
        state: k.status === "working" ? "running" : k.status || "live",
        busy: k.status === "working",
        age: null,
        detail: k.address,
        address: k.address,
      })),
      ...agySubs.map((s, idx) => ({
        id: `sa-${s.cid || idx}`,
        source: "agy",
        role: s.role || s.type_name || "subagent",
        type: s.kind === "swarm" ? "SWM" : s.type_name || "SUB",
        model: shortModel(s.model),
        state: s.state || (s.busy ? "running" : "done"),
        busy: Boolean(s.busy || s.state === "running"),
        age: s.age_sec,
        detail: s.last_tool || (s.steps ? `${s.steps} steps` : ""),
        cid: s.cid,
      })),
    ];

    const liveCount = nodes.filter((n) => n.busy || n.state === "running").length;
    const otherActive = Object.values(tel.terminals ?? {})
      .filter((x) => x.terminal !== sp.id && (x.subagents?.length ?? 0) > 0)
      .slice(0, 3);

    const isOverlay = Boolean(props()?.overlay);

    return v_flex()
      .id("modulor-swarm")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(24)
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
              .child(div().text_size(10.5).font_semibold().child("Swarm & Subagents"))
              .when(liveCount > 0, (el) =>
                el.child(
                  div()
                    .px(4)
                    .h(14)
                    .flex()
                    .items_center()
                    .bg(t.working)
                    .text_color("#FAF8F4")
                    .font_family("Geist Mono")
                    .text_size(8.5)
                    .font_bold()
                    .loop("opacity", { from: 0.45, to: 1, period: 900 })
                    .child(`${liveCount} LIVE`),
                ),
              ),
          )
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                div()
                  .font_family("Geist Mono")
                  .text_size(9.5)
                  .text_color(t.dim)
                  .child(`${nodes.length} NODES`),
              )
              .when(isOverlay, (el) =>
                el.child(
                  div()
                    .id("msw-close")
                    .px(4)
                    .cursor_pointer()
                    .text_size(10)
                    .text_color(t.muted)
                    .hover((s) => s.bg(t.hover).text_color(t.foreground))
                    .on_click(() => closeOverlay(props().overlay))
                    .child("ESC"),
                ),
              ),
          ),
      )
      .child(
        v_flex()
          .id("msw-scroll")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .when(nodes.length === 0, (el) =>
            v_flex()
              .p(10)
              .gap(6)
              .child(
                div()
                  .text_size(10.5)
                  .text_color(t.dim)
                  .child(
                    sp.id
                      ? `No subagents spawned in ${sp.id}`
                      : "Focus an agent pane to inspect subagent tree",
                  ),
              )
              .when(otherActive.length > 0, (subEl) =>
                subEl.child(
                  h_flex()
                    .gap(4)
                    .flex_wrap()
                    .children(
                      otherActive.map((ot) => {
                        const addr = mk === "__local__" ? ot.terminal : `${mk}/${ot.terminal}`;
                        return div()
                          .id(`msw-jmp-${ot.terminal}`)
                          .px(5)
                          .h(18)
                          .flex()
                          .items_center()
                          .bg(t.surface)
                          .border(1)
                          .border_color(t.border)
                          .font_family("Geist Mono")
                          .text_size(9.5)
                          .text_color(t.foreground)
                          .cursor_pointer()
                          .hover((s) => s.bg(t.hover))
                          .on_click(() => run("agent.focus", { terminal: addr }))
                          .child(`${ot.terminal} (${ot.subagents.length})`);
                      }),
                    ),
                ),
              ),
          )
          .when(nodes.length > 0, (el) =>
            el
              .child(
                h_flex()
                  .px(10)
                  .h(22)
                  .gap(6)
                  .items_center()
                  .bg(t.surface)
                  .border_b(1)
                  .border_color(t.border)
                  .child(
                    div()
                      .px(4)
                      .h(14)
                      .flex()
                      .items_center()
                      .bg("#191816")
                      .text_color("#FAF8F4")
                      .font_family("Geist Mono")
                      .text_size(8.5)
                      .font_bold()
                      .child(sp.id || "ROOT"),
                  )
                  .child(
                    div()
                      .flex_1()
                      .min_w(0)
                      .truncate()
                      .text_size(10)
                      .font_medium()
                      .text_color(t.foreground)
                      .child(term?.title || term?.work_dir || "Parent session"),
                  ),
              )
              .children(
                nodes.map((n, idx) => {
                  const branch = idx === nodes.length - 1 ? "└─" : "├─";
                  const isErr = n.state === "error";
                  const badgeBg = n.busy ? t.working : isErr ? t.blocked : n.source === "hc" ? t.foreground : t.done;
                  const badgeTxt = n.busy ? "RUN" : isErr ? "ERR" : n.source === "hc" ? "LIVE" : "DONE";
                  const clickable = n.source === "hc" || Boolean(n.cid);

                  return h_flex()
                    .id(n.id)
                    .px(10)
                    .py(5)
                    .gap(5)
                    .items_center()
                    .justify_between()
                    .border_b(1)
                    .border_color(t.border)
                    .when(clickable, (r) =>
                      r
                        .cursor_pointer()
                        .hover((s) => s.bg(t.hover))
                        .tooltip(
                          n.source === "hc"
                            ? `Peek child terminal ${n.address}`
                            : `Open subagent brain (${n.cid})`,
                        )
                        .on_click((_e, cx) => {
                          if (n.source === "hc") {
                            run("terminal.peek", { terminal: n.address });
                          } else {
                            this.openSubagentBrain(n.cid, mk, cx);
                          }
                        }),
                    )
                    .child(
                      h_flex()
                        .flex_1()
                        .min_w(0)
                        .gap(5)
                        .items_center()
                        .child(
                          div()
                            .font_family("Geist Mono")
                            .text_size(10)
                            .text_color(t.dim)
                            .child(branch),
                        )
                        .child(
                          div()
                            .w(30)
                            .h(14)
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(badgeBg)
                            .text_color("#FAF8F4")
                            .font_family("Geist Mono")
                            .text_size(8)
                            .font_bold()
                            .when(n.busy, (b) => b.loop("opacity", { from: 0.45, to: 1, period: 900 }))
                            .child(badgeTxt),
                        )
                        .child(
                          div()
                            .truncate()
                            .text_size(10.5)
                            .font_medium()
                            .text_color(t.foreground)
                            .child(n.role),
                        )
                        .when(Boolean(n.detail), (dEl) =>
                          dEl.child(
                            div()
                              .truncate()
                              .font_family("Geist Mono")
                              .text_size(9)
                              .text_color(t.muted)
                              .child(n.detail),
                          ),
                        ),
                    )
                    .child(
                      h_flex()
                        .flex_none()
                        .gap(5)
                        .items_center()
                        .when(Boolean(n.model), (mEl) =>
                          mEl.child(
                            div()
                              .font_family("Geist Mono")
                              .text_size(8.5)
                              .text_color(t.dim)
                              .child(n.model),
                          ),
                        )
                        .when(typeof n.age === "number", (aEl) =>
                          aEl.child(
                            div()
                              .font_family("Geist Mono")
                              .text_size(9)
                              .text_color(t.dim)
                              .child(fmtAge(n.age)),
                          ),
                        ),
                    );
                }),
              ),
          ),
      );
  }
}
