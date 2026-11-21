import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, theme, home, shared, checking } from "herdr";

const READ_FLAGS = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const KEY_TELEMETRY = "modulor.telemetry";

function splitAddr(addr) {
  if (!addr) return { machine: "__local__", id: "" };
  const idx = addr.indexOf("/");
  if (idx > 0) return { machine: addr.slice(0, idx), id: addr.slice(idx + 1) };
  return { machine: "__local__", id: addr };
}

function telemetryForFocused(f) {
  if (!f?.terminal) return null;
  const { machine, id } = splitAddr(f.terminal);
  const tel = shared(KEY_TELEMETRY) ?? {};
  return id ? tel[machine]?.terminals?.[id] ?? null : null;
}

function location() {
  const space = spaces().find((s) => s.active);
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on =
    f?.pane === null
      ? f.terminal?.includes("/")
        ? f.terminal.split("/")[0]
        : null
      : space?.machine ?? null;
  const tInfo = telemetryForFocused(f);
  const fallbackCwd = pane?.cwd || f?.cwd || space?.folder || null;
  const inferredCwd = tInfo?.inferred_cwd || null;
  return {
    cwd: inferredCwd || fallbackCwd,
    fallbackCwd,
    inferred: Boolean(inferredCwd && inferredCwd !== fallbackCwd),
    on,
  };
}

function statusMeta(xy, t) {
  if (xy.includes("U") || xy === "AA" || xy === "DD") return ["U", t.blocked];
  if (xy.includes("D")) return ["D", t.blocked];
  if (xy === "??" || xy.includes("A")) return ["A", t.done];
  return ["M", t.working];
}

export default class ModulorGit extends View {
  init(_props, cx) {
    this.repo = null;
    this.branch = "";
    this.ahead = 0;
    this.behind = 0;
    this.files = [];
    this.isInferred = false;
    this.note = "Checking git...";
    this.loading = false;
    this.lastCtx = "";
    this.tick = 0;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(2000, (cx) => {
      this.tick += 1;
      const loc = location();
      const ctxKey = JSON.stringify([loc.cwd, loc.on]);
      if (ctxKey !== this.lastCtx || this.tick % 4 === 0) {
        this.refresh(cx);
      }
    });
  }

  refresh(cx) {
    const loc = location();
    const ctxKey = JSON.stringify([loc.cwd, loc.on]);
    if (ctxKey !== this.lastCtx) {
      this.lastCtx = ctxKey;
      this.loading = false;
      this.note = "Checking git...";
    }
    if (this.loading || !loc.cwd) {
      if (!loc.cwd) {
        this.repo = null;
        this.branch = "";
        this.files = [];
        this.isInferred = false;
        this.note = "No active folder";
        cx.notify();
      }
      return;
    }
    this.loading = true;

    cx.spawn(async (cx) => {
      try {
        let targetCwd = loc.cwd;
        let usedInferred = loc.inferred;
        let top = await exec("git", [...READ_FLAGS, "rev-parse", "--show-toplevel"], {
          cwd: targetCwd,
          on: loc.on,
          timeout: 4000,
        });
        if (top.code !== 0 && loc.fallbackCwd && loc.fallbackCwd !== targetCwd) {
          targetCwd = loc.fallbackCwd;
          usedInferred = false;
          top = await exec("git", [...READ_FLAGS, "rev-parse", "--show-toplevel"], {
            cwd: targetCwd,
            on: loc.on,
            timeout: 4000,
          });
        }
        const curLoc = location();
        if (JSON.stringify([curLoc.cwd, curLoc.on]) !== ctxKey) return;
        if (top.code !== 0) {
          this.repo = null;
          this.branch = "";
          this.files = [];
          this.isInferred = false;
          this.note = "No git repo in focused folder";
          return;
        }
        const root = top.stdout.trim();
        const isHome = !loc.on && root === home();
        const untracked = isHome ? "--untracked-files=no" : "--untracked-files=normal";
        const git = (args) => exec("git", [...READ_FLAGS, ...args], { cwd: root, on: loc.on, timeout: 4000 });

        const [brRes, abRes, stRes, diffRes] = await Promise.all([
          git(["symbolic-ref", "--short", "HEAD"]),
          git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
          git(["status", "--porcelain=v1", "-z", "--no-renames", untracked]),
          git(["diff", "HEAD", "--numstat", "-z", "--no-renames"]),
        ]);
        const endLoc = location();
        if (JSON.stringify([endLoc.cwd, endLoc.on]) !== ctxKey) return;

        let branch = brRes.code === 0 ? brRes.stdout.trim() : "";
        if (!branch) {
          const sha = await git(["rev-parse", "--short", "HEAD"]);
          branch = sha.code === 0 ? sha.stdout.trim() : "HEAD";
        }
        let ahead = 0;
        let behind = 0;
        if (abRes.code === 0) {
          const parts = abRes.stdout.trim().split(/\s+/).map(Number);
          ahead = parts[0] || 0;
          behind = parts[1] || 0;
        }

        const stats = {};
        if (diffRes.code === 0) {
          for (const row of diffRes.stdout.split("\0")) {
            const [a, d, ...rest] = row.split("\t");
            if (!rest.length) continue;
            const p = rest.join("\t");
            stats[p] = { add: Number(a) || 0, del: Number(d) || 0 };
          }
        }

        const files = [];
        if (stRes.code === 0) {
          for (const entry of stRes.stdout.split("\0").filter(Boolean).slice(0, 60)) {
            const xy = entry.slice(0, 2);
            const path = entry.slice(3);
            const st = stats[path] ?? { add: 0, del: 0 };
            files.push({ xy, path, ...st });
          }
        }

        this.repo = root.split("/").pop() || root;
        this.branch = branch;
        this.ahead = ahead;
        this.behind = behind;
        this.files = files;
        this.isInferred = usedInferred;
        this.note = files.length === 0 ? (isHome ? "Clean (tracked dotfiles)" : "Working tree clean") : "";
      } catch {
        this.note = "Git unavailable";
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    return v_flex()
      .id("modulor-git")
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
              .child(div().text_size(11).font_semibold().child("Workspace Git"))
              .when(this.isInferred, (el) =>
                el.child(
                  div()
                    .px(4)
                    .h(14)
                    .flex()
                    .items_center()
                    .bg("#191816")
                    .text_color("#FAF8F4")
                    .font_family("Geist Mono")
                    .text_size(8.5)
                    .font_semibold()
                    .child("TRACK"),
                ),
              ),
          )
          .when(Boolean(this.branch), (el) =>
            el.child(
              h_flex()
                .gap(4)
                .items_center()
                .child(svg("mods/modulor-bar/icons/branch.svg").size(10).text_color(t.muted))
                .child(
                  div()
                    .max_w(130)
                    .truncate()
                    .font_family("Geist Mono")
                    .text_size(10)
                    .text_color(t.foreground)
                    .child(`${this.repo ?? ""}:${this.branch}`),
                )
                .when(this.ahead > 0 || this.behind > 0, (x) =>
                  x.child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .text_color(t.done)
                      .child(`${this.ahead ? `+${this.ahead}` : ""}${this.behind ? `-${this.behind}` : ""}`),
                  ),
                ),
            ),
          ),
      )
      .child(
        v_flex()
          .id("mg-scroll")
          .flex_1()
          .min_h(0)
          .pr(4)
          .overflow_y_scrollbar()
          .when(this.files.length === 0, (el) =>
            el.child(
              div()
                .px(10)
                .py(8)
                .text_size(11)
                .text_color(t.dim)
                .child(this.note || "Working tree clean"),
            ),
          )
          .children(
            this.files.map((f, idx) => {
              const [ch, col] = statusMeta(f.xy, t);
              const name = f.path.split("/").pop();
              const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
              return h_flex()
                .id(`mg-f-${idx}`)
                .px(10)
                .py(5)
                .gap(6)
                .items_center()
                .justify_between()
                .border_b(1)
                .border_color(t.border)
                .tooltip(f.path)
                .child(
                  h_flex()
                    .flex_1()
                    .min_w(0)
                    .gap(6)
                    .items_center()
                    .child(
                      div()
                        .w(14)
                        .h(14)
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .bg(col)
                        .text_color("#FAF8F4")
                        .font_family("Geist Mono")
                        .text_size(9)
                        .font_bold()
                        .child(ch),
                    )
                    .child(
                      div()
                        .truncate()
                        .text_size(11)
                        .font_medium()
                        .text_color(t.foreground)
                        .child(name),
                    )
                    .when(Boolean(dir), (el) =>
                      el.child(div().truncate().text_size(10).text_color(t.dim).child(dir)),
                    ),
                )
                .when(f.add > 0 || f.del > 0, (el) =>
                  el.child(
                    div()
                      .flex_none()
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .text_color(t.muted)
                      .child(`${f.add ? `+${f.add}` : ""}${f.add && f.del ? " " : ""}${f.del ? `-${f.del}` : ""}`),
                  ),
                );
            }),
          ),
      );
  }
}
