import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  watchFolder,
  pickFolder,
  exec,
  shared,
  setShared,
  notify,
  closeOverlay,
  checking,
  props,
  theme,
} from "herdr";

const KEY_LOGS = "modulor.logs";

const PY_TAIL = [
  "import json, os, sys",
  "root = sys.argv[1]",
  "EXTS = ('.log', '.txt', '.jsonl', '.err', '.out')",
  "best = None",
  "for dp, dirs, files in os.walk(root):",
  "  dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', '.next', 'dist', '__pycache__')]",
  "  rel_depth = 0 if dp == root else len(os.path.relpath(dp, root).split(os.sep))",
  "  if rel_depth >= 2:",
  "    dirs[:] = []",
  "  for fn in files:",
  "    if not (fn.endswith(EXTS) or 'log' in fn.lower()):",
  "      continue",
  "    fp = os.path.join(dp, fn)",
  "    try:",
  "      st = os.stat(fp)",
  "    except OSError:",
  "      continue",
  "    if best is None or st.st_mtime > best[0]:",
  "      best = (st.st_mtime, fp)",
  "if not best:",
  "  print(json.dumps({'file': None, 'lines': []}))",
  "  sys.exit(0)",
  "fp = best[1]",
  "try:",
  "  sz = os.path.getsize(fp)",
  "  with open(fp, 'rb') as f:",
  "    if sz > 131072:",
  "      f.seek(sz - 131072)",
  "      f.readline()",
  "    raw = f.read().decode('utf-8', 'ignore').splitlines()[-160:]",
  "except OSError:",
  "  raw = []",
  "print(json.dumps({'file': os.path.relpath(fp, root), 'full': fp, 'mtime': int(best[0]), 'lines': raw}))",
].join("\n");

const ERR_RE = /\b(error|fatal|panic|exception|traceback|failed|fail)\b/i;
const WARN_RE = /\b(warn|warning)\b/i;

function classifyLine(line) {
  if (ERR_RE.test(line)) return "err";
  if (WARN_RE.test(line)) return "warn";
  return "ok";
}

function baseName(p) {
  const s = String(p ?? "").replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) || s : s;
}

export default class ModulorLog extends View {
  init(_p, cx) {
    this.activeIdx = 0;
    this.errOnly = false;
    this.fileLabel = null;
    this.fullPath = null;
    this.lines = [];
    this.clearedAt = {};
    this.lastErrSig = {};
    this.lastNotifyAt = {};
    this.activeWatch = null;
    this.watchedPath = null;
    this.closed = false;

    if (checking()) return;
    if (props()?.overlay) setShared("modulor.logOverlayId", props().overlay);

    cx.spawn(async (cx) => {
      await this.refreshTail();
      cx.notify();
      this.ensureWatch(cx);
      for (;;) {
        await cx.sleep(8000);
        if (this.closed) break;
        this.ensureWatch(cx);
        await this.refreshTail();
        cx.notify();
      }
    });
  }

  async close() {
    this.closed = true;
    try {
      this.activeWatch?.cancel?.();
    } catch {}
    this.activeWatch = null;
    if (shared("modulor.logOverlayId") === props()?.overlay) {
      setShared("modulor.logOverlayId", null);
    }
  }

  getSources() {
    const raw = shared(KEY_LOGS);
    return Array.isArray(raw) ? raw.filter((x) => x && x.path) : [];
  }

  currentSource() {
    const srcs = this.getSources();
    if (srcs.length === 0) return null;
    const idx = Math.max(0, Math.min(this.activeIdx, srcs.length - 1));
    return srcs[idx];
  }

  ensureWatch(cx) {
    if (this.closed) return;
    const cur = this.currentSource();
    const target = cur?.path ?? null;
    if (target === this.watchedPath) return;

    try {
      this.activeWatch?.cancel?.();
    } catch {}
    this.activeWatch = null;
    this.watchedPath = target;
    if (!target) return;

    cx.spawn(async (cx) => {
      while (!this.closed && this.watchedPath === target) {
        try {
          const w = watchFolder(target);
          this.activeWatch = w;
          const ev = await w;
          if (this.closed || this.watchedPath !== target) break;
          if (!ev || ev.length === 0) continue;
          await this.refreshTail();
          cx.notify();
        } catch {
          await cx.sleep(5000);
        }
      }
    });
  }

  async refreshTail() {
    const cur = this.currentSource();
    if (!cur) {
      this.fileLabel = null;
      this.fullPath = null;
      this.lines = [];
      return;
    }
    try {
      const r = await exec("python3", ["-c", PY_TAIL, cur.path], { timeout: 4000 });
      if (r.code !== 0 || !r.stdout) return;
      const data = JSON.parse(r.stdout);
      this.fileLabel = data.file;
      this.fullPath = data.full ?? null;
      const rawLines = Array.isArray(data.lines) ? data.lines : [];
      const clearMin = this.clearedAt[cur.path] ?? 0;
      const sliced = clearMin > 0 && clearMin <= rawLines.length ? rawLines.slice(clearMin) : rawLines;
      this.lines = sliced.map((txt) => ({ txt, lvl: classifyLine(txt) }));

      // Notify once (debounced 15s) when new error lines appear after baseline
      const errs = this.lines.filter((l) => l.lvl === "err");
      const lastErr = errs.length > 0 ? errs[errs.length - 1].txt : null;
      const prevSig = this.lastErrSig[cur.path];
      if (lastErr) {
        const now = Date.now();
        if (prevSig !== undefined && prevSig !== lastErr && now - (this.lastNotifyAt[cur.path] ?? 0) >= 15000) {
          this.lastNotifyAt[cur.path] = now;
          notify({
            title: `Log Error · ${cur.name}`,
            body: lastErr.slice(0, 110),
            level: "error",
            action: { name: "modulor-bar.logs" },
          });
        }
        this.lastErrSig[cur.path] = lastErr;
      } else if (prevSig === undefined) {
        this.lastErrSig[cur.path] = "";
      }
    } catch {}
  }

  async addFolder(cx) {
    if (checking()) return;
    if (props()?.overlay) setShared("modulor.logOverlayId", props().overlay);
    const picked = await pickFolder({ prompt: "Watch Logs" });
    if (!picked) return;
    const srcs = this.getSources();
    const existingIdx = srcs.findIndex((s) => s.path === picked);
    if (existingIdx >= 0) {
      this.activeIdx = existingIdx;
    } else {
      const next = [...srcs, { name: baseName(picked), path: picked }];
      setShared(KEY_LOGS, next);
      this.activeIdx = next.length - 1;
    }
    this.ensureWatch(cx);
    await this.refreshTail();
    cx.notify();
  }

  async removeCurrent(cx) {
    const srcs = this.getSources();
    const cur = this.currentSource();
    if (!cur) return;
    const next = srcs.filter((s) => s.path !== cur.path);
    setShared(KEY_LOGS, next);
    this.activeIdx = Math.max(0, Math.min(this.activeIdx, next.length - 1));
    this.ensureWatch(cx);
    await this.refreshTail();
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const srcs = this.getSources();
    const cur = this.currentSource();
    const shownLines = this.errOnly
      ? this.lines.filter((l) => l.lvl === "err" || l.lvl === "warn")
      : this.lines;
    const errCount = this.lines.filter((l) => l.lvl === "err").length;

    const btn = (id, label, onClick, active = false) =>
      div()
        .id(id)
        .px(6)
        .h(18)
        .flex()
        .items_center()
        .bg(active ? t.blocked : "#302E2A")
        .border(1)
        .border_color(active ? t.blocked : "#4A4741")
        .font_family("Geist Mono")
        .text_size(9.5)
        .text_color("#FAF8F4")
        .cursor_pointer()
        .hover((s) => s.bg(active ? t.blocked : "#423F39"))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(onClick)
        .child(label);

    return v_flex()
      .id("modulor-log")
      .size_full()
      .bg(t.popover)
      .border(1)
      .border_color(t.input)
      .text_color(t.foreground)
      // Header (drag handle on empty area; buttons stop propagation)
      .child(
        h_flex()
          .h(32)
          .px(10)
          .flex_none()
          .items_center()
          .justify_between()
          .bg("#191816")
          .text_color("#FAF8F4")
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(div().font_family("Geist Mono").text_size(11).font_semibold().child("MODULOR LOG WATCH"))
              .when(errCount > 0, (el) =>
                el.child(
                  div()
                    .px(4)
                    .h(15)
                    .flex()
                    .items_center()
                    .bg(t.blocked)
                    .font_family("Geist Mono")
                    .text_size(9)
                    .font_bold()
                    .child(`${errCount} ERR`),
                ),
              ),
          )
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(btn("ml-add", "+ Folder", (_e, cx) => this.addFolder(cx)))
              .child(
                btn(
                  "ml-filter",
                  this.errOnly ? "ERR ONLY" : "ALL",
                  (_e, cx) => {
                    this.errOnly = !this.errOnly;
                    cx.notify();
                  },
                  this.errOnly,
                ),
              )
              .when(Boolean(cur), (el) =>
                el.child(
                  btn("ml-clear", "Clear", (_e, cx) => {
                    this.clearedAt[cur.path] = (this.clearedAt[cur.path] ?? 0) + this.lines.length;
                    this.lines = [];
                    cx.notify();
                  }),
                ),
              )
              .when(Boolean(this.fullPath), (el) =>
                el.child(
                  btn("ml-open", "Open", () => {
                    if (!checking() && this.fullPath) exec("open", [this.fullPath]).catch(() => {});
                  }),
                ),
              )
              .child(
                div()
                  .id("ml-close")
                  .px(5)
                  .h(18)
                  .flex()
                  .items_center()
                  .cursor_pointer()
                  .font_family("Geist Mono")
                  .text_size(10)
                  .text_color("#C9C3B6")
                  .hover((s) => s.bg("#302E2A").text_color("#FAF8F4"))
                  .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                  .on_click(() => closeOverlay(props().overlay))
                  .child("ESC"),
              ),
          ),
      )
      // Source tabs bar
      .when(srcs.length > 0, (el) =>
        el.child(
          h_flex()
            .h(24)
            .px(8)
            .gap(4)
            .flex_none()
            .items_center()
            .justify_between()
            .bg(t.raised)
            .border_b(1)
            .border_color(t.border)
            .child(
              h_flex()
                .gap(4)
                .items_center()
                .children(
                  srcs.map((s, idx) => {
                    const active = cur && cur.path === s.path;
                    return div()
                      .id(`ml-tab-${idx}`)
                      .px(6)
                      .h(16)
                      .flex()
                      .items_center()
                      .bg(active ? t.foreground : t.surface)
                      .border(1)
                      .border_color(active ? t.foreground : t.border)
                      .text_color(active ? t.background : t.muted)
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .cursor_pointer()
                      .tooltip(s.path)
                      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                      .on_click(async (_e, cx) => {
                        this.activeIdx = idx;
                        this.ensureWatch(cx);
                        await this.refreshTail();
                        cx.notify();
                      })
                      .child(s.name);
                  }),
                ),
            )
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .when(Boolean(this.fileLabel), (fEl) =>
                  fEl.child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .text_color(t.dim)
                      .child(this.fileLabel),
                  ),
                )
                .child(
                  div()
                    .id("ml-rm")
                    .px(4)
                    .cursor_pointer()
                    .font_family("Geist Mono")
                    .text_size(10)
                    .text_color(t.muted)
                    .tooltip("Remove watched folder")
                    .hover((s) => s.bg(t.hover).text_color(t.blocked))
                    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                    .on_click((_e, cx) => this.removeCurrent(cx))
                    .child("×"),
                ),
            ),
        ),
      )
      // Log viewport
      .child(
        v_flex()
          .id("ml-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .when(srcs.length === 0, (el) =>
            v_flex()
              .flex_1()
              .items_center()
              .justify_center()
              .gap(10)
              .p(20)
              .child(
                div()
                  .text_size(12)
                  .text_color(t.muted)
                  .child("Pick a log or build output folder to tail the newest log live."),
              )
              .child(
                div()
                  .id("ml-empty-add")
                  .px(10)
                  .py(5)
                  .bg("#191816")
                  .text_color("#FAF8F4")
                  .font_family("Geist Mono")
                  .text_size(10.5)
                  .font_semibold()
                  .cursor_pointer()
                  .hover((s) => s.bg("#302E2A"))
                  .on_click((_e, cx) => this.addFolder(cx))
                  .child("+ Add Log Folder"),
              ),
          )
          .when(srcs.length > 0 && shownLines.length === 0, (el) =>
            el.child(
              div()
                .p(12)
                .font_family("Geist Mono")
                .text_size(11)
                .text_color(t.dim)
                .child(
                  this.fileLabel
                    ? "No matching log lines."
                    : `No .log/.txt/.jsonl/.err/.out files found in ${cur?.path ?? ""}`,
                ),
            ),
          )
          .children(
            shownLines.slice(-140).map((ln, idx) => {
              const isErr = ln.lvl === "err";
              const isWarn = ln.lvl === "warn";
              return h_flex()
                .id(`ml-ln-${idx}`)
                .px(8)
                .py(2)
                .border_l(isErr || isWarn ? 3 : 0)
                .border_color(isErr ? t.blocked : t.working)
                .bg(isErr ? "#F5E6E3" : isWarn ? "#FAF2E4" : t.popover)
                .child(
                  div()
                    .font_family("Geist Mono")
                    .text_size(10.5)
                    .text_color(isErr ? t.blocked : isWarn ? t.working : t.foreground)
                    .child(ln.txt),
                );
            }),
          ),
      );
  }
}
