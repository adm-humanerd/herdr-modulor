import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  spaces,
  agents,
  panes,
  focused,
  knownAgents,
  exec,
  readTextFile,
  appHome,
  home,
  theme,
  shared,
  run,
  notify,
  props,
  openOverlay,
  closeOverlay,
  checking,
} from "herdr";

const KEY_TEL = "modulor.telemetry";

const PY_SCAN_REPOS = [
  "import json, pathlib",
  "home = pathlib.Path.home()",
  "repos = []",
  "seen = set()",
  "for base in [home / 'Projects', home]:",
  "  if not base.is_dir(): continue",
  "  for p in base.iterdir():",
  "    if p.name.startswith('.') or not p.is_dir(): continue",
  "    sp = str(p)",
  "    if sp in seen: continue",
  "    if (p / '.git').exists():",
  "      seen.add(sp)",
  "      repos.append((p.stat().st_mtime, p.name, sp))",
  "repos.sort(reverse=True)",
  "print(json.dumps([{'name': n, 'path': sp} for _, n, sp in repos[:12]]))",
].join("\n");

const PY_PORTS = [
  "import json, os, re, subprocess",
  "res = subprocess.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], capture_output=True, text=True, timeout=3)",
  "rows = []",
  "cur_pid = None; cur_cmd = ''",
  "for ln in res.stdout.splitlines():",
  "  if ln.startswith('p'): cur_pid = ln[1:]; cur_cmd = ''",
  "  elif ln.startswith('c'): cur_cmd = ln[1:]",
  "  elif ln.startswith('n') and cur_pid:",
  "    m = re.search(r':(\\d+)$', ln[1:])",
  "    if m:",
  "      port = int(m.group(1))",
  "      if 1024 <= port <= 65535:",
  "        rows.append((port, cur_pid, cur_cmd, ln[1:]))",
  "uniq = {}; pids = set()",
  "for port, pid, cmd, addr in rows:",
  "  if cmd in ('ControlCe', 'rapportd', 'AirPlayXP', 'Herdr', 'herdr-cor'): continue",
  "  k = (port, pid)",
  "  if k not in uniq:",
  "    uniq[k] = {'port': port, 'pid': pid, 'cmd': cmd, 'addr': addr, 'cwd': ''}",
  "    pids.add(pid)",
  "if pids:",
  "  cw = subprocess.run(['lsof', '-a', '-p', ','.join(pids), '-d', 'cwd', '-Fn'], capture_output=True, text=True, timeout=2)",
  "  p_now = None",
  "  for ln in cw.stdout.splitlines():",
  "    if ln.startswith('p'): p_now = ln[1:]",
  "    elif ln.startswith('n') and p_now:",
  "      for item in uniq.values():",
  "        if item['pid'] == p_now: item['cwd'] = ln[1:]",
  "out = sorted(uniq.values(), key=lambda x: x['port'])",
  "print(json.dumps(out[:24]))",
].join("\n");

const PY_STAGE_THUMBS = [
  "import json, hashlib, os, shutil, sys",
  "dst_dir = sys.argv[1]",
  "items = json.loads(sys.argv[2])",
  "os.makedirs(dst_dir, exist_ok=True)",
  "out = []",
  "for it in items[:4]:",
  "  src = it.get('path') or ''",
  "  if not os.path.isfile(src): continue",
  "  ext = os.path.splitext(src)[1].lower() or '.png'",
  "  h = hashlib.sha1(src.encode()).hexdigest()[:10]",
  "  fn = f'{h}{ext}'",
  "  dst = os.path.join(dst_dir, fn)",
  "  try:",
  "    if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst):",
  "      shutil.copy2(src, dst)",
  "    out.append({'name': it.get('name') or fn, 'rel': f'.planche-thumbs/{fn}', 'path': src})",
  "  except OSError:",
  "    pass",
  "print(json.dumps(out))",
].join("\n");

function splitAddr(addr) {
  if (!addr) return { machine: "__local__", id: "" };
  const idx = addr.indexOf("/");
  if (idx > 0) return { machine: addr.slice(0, idx), id: addr.slice(idx + 1) };
  return { machine: "__local__", id: addr };
}

function fmtUsd(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return "";
  return v >= 100 ? `≈$${v.toFixed(0)}` : `≈$${v.toFixed(2)}`;
}

function fmtTok(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 999500) return `${Math.round(n / 1000)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function baseName(p) {
  if (!p) return "";
  const s = String(p).replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) || s : s;
}

function parseMarkdownBlocks(text) {
  if (!text) return [];
  const lines = text.split("\n").slice(0, 260);
  const blocks = [];
  let inCode = false;
  let codeBuf = [];

  for (const raw of lines) {
    const ln = raw.replace(/\r$/, "");
    if (ln.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({ kind: "code", text: codeBuf.join("\n") });
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(ln);
      continue;
    }
    const trim = ln.trim();
    if (!trim) continue;
    const hMatch = /^(#{1,3})\s+(.+)$/.exec(trim);
    if (hMatch) {
      blocks.push({ kind: `h${hMatch[1].length}`, text: hMatch[2] });
      continue;
    }
    const todoMatch = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trim);
    if (todoMatch) {
      blocks.push({ kind: "todo", done: todoMatch[1] !== " ", text: todoMatch[2] });
      continue;
    }
    if (trim.startsWith(">")) {
      blocks.push({ kind: "quote", text: trim.replace(/^>\s?/, "") });
      continue;
    }
    if (/^[-*]\s+/.test(trim) || /^\d+\.\s+/.test(trim)) {
      blocks.push({ kind: "bullet", text: trim.replace(/^([-*]|\d+\.)\s+/, "") });
      continue;
    }
    blocks.push({ kind: "p", text: trim });
  }
  if (codeBuf.length > 0) blocks.push({ kind: "code", text: codeBuf.join("\n") });
  return blocks;
}

export default class ModulorPlanche extends View {
  init(_p, cx) {
    this.tab = props()?.tab || "wall";
    this.pinTid = null;
    this.selectedDocPath = null;
    this.docText = "";
    this.docSig = null;
    this.repoDocs = [];
    this.thumbs = [];
    this.thumbSig = "";
    this.repos = [];
    this.ports = [];
    this.defaultArgv = null;

    if (checking()) return;

    cx.spawn(async (cx) => {
      try {
        const ag = await knownAgents();
        const inst = ag.filter((a) => a.installed && Array.isArray(a.run) && a.run.length > 0);
        const pref = inst.find((a) => a.key === "agy") || inst.find((a) => a.key === "claude") || inst[0];
        if (pref) this.defaultArgv = pref.run;
      } catch {}
      try {
        const r = await exec("python3", ["-c", PY_SCAN_REPOS], { timeout: 4000 });
        if (r.code === 0 && r.stdout) this.repos = JSON.parse(r.stdout);
      } catch {}
      if (this.tab === "planche") await this.syncPlancheDocs(cx);
      if (this.tab === "ports") await this.pollPorts(cx);
      cx.notify();

      for (;;) {
        if (this.tab === "planche") await this.syncPlancheDocs(cx);
        if (this.tab === "ports") await this.pollPorts(cx);
        await cx.sleep(3500);
      }
    });
  }

  resolveTargetAgent(tel) {
    const agList = agents();
    const foc = focused();
    const fSp = splitAddr(foc?.terminal);
    const tid = this.pinTid || (tel.terminals?.[fSp.id] ? fSp.id : null) || Object.keys(tel.terminals ?? {})[0] || null;
    const term = tid ? tel.terminals?.[tid] ?? null : null;
    const ag = agList.find((a) => splitAddr(a.address).id === tid) ?? null;
    return { tid, term, ag };
  }

  async syncPlancheDocs(cx) {
    const store = shared(KEY_TEL) ?? {};
    const tel = store.__local__ ?? {};
    const { tid, term } = this.resolveTargetAgent(tel);
    if (!term) return;

    // 1. Collect markdown docs from artifacts + workspace root
    const docs = [];
    const seen = new Set();
    for (const art of term.artifact_items ?? []) {
      if (art.path && art.path.endsWith(".md") && !seen.has(art.path)) {
        seen.add(art.path);
        docs.push({ name: art.name, path: art.path, kind: "ART" });
      }
    }
    const cwd = term.inferred_cwd;
    if (cwd && cwd !== home()) {
      for (const fn of ["HANDOFF.md", "PLAN.md", "AGENTS.md", "CLAUDE.md", "README.md"]) {
        const p = `${cwd}/${fn}`;
        if (!seen.has(p)) {
          const content = await readTextFile(p).catch(() => null);
          if (content) {
            seen.add(p);
            docs.push({ name: fn, path: p, kind: "DOC" });
          }
        }
      }
    }
    this.repoDocs = docs;
    if ((!this.selectedDocPath || !seen.has(this.selectedDocPath)) && docs.length > 0) {
      this.selectedDocPath = docs[0].path;
    }
    if (this.selectedDocPath) {
      const txt = await readTextFile(this.selectedDocPath).catch(() => null);
      if (txt !== null && txt !== this.docText) {
        this.docText = txt;
      }
    } else {
      this.docText = "";
    }

    // 2. Stage PNG/JPG artifacts into ~/.config/herdr-app/.planche-thumbs for native image() preview
    const imgItems = (term.artifact_items ?? []).filter((a) =>
      /\.(png|jpe?g|webp)$/i.test(a.name || ""),
    );
    const sig = `${tid}:${imgItems.map((i) => i.path).join(",")}`;
    if (sig !== this.thumbSig) {
      this.thumbSig = sig;
      if (imgItems.length === 0) {
        this.thumbs = [];
      } else {
        const dstDir = `${appHome().replace(/\\/g, "/")}/.planche-thumbs`;
        const r = await exec("python3", ["-c", PY_STAGE_THUMBS, dstDir, JSON.stringify(imgItems)], {
          timeout: 4000,
        }).catch(() => null);
        if (r?.code === 0 && r.stdout) {
          try {
            this.thumbs = JSON.parse(r.stdout);
          } catch {}
        }
      }
    }
    cx.notify();
  }

  async pollPorts(cx) {
    try {
      const r = await exec("python3", ["-c", PY_PORTS], { timeout: 4000 });
      if (r.code === 0 && r.stdout) {
        this.ports = JSON.parse(r.stdout);
        cx.notify();
      }
    } catch {}
  }

  renderWall(t, tel, cx) {
    const agList = agents();
    const allPanes = panes();
    const conflicts = tel.conflicts ?? [];
    const activeCwds = new Set(
      Object.values(tel.terminals ?? {})
        .map((x) => x.inferred_cwd)
        .filter(Boolean),
    );
    const idleRepos = this.repos.filter((r) => !activeCwds.has(r.path)).slice(0, 6);

    const cards = agList.map((a, idx) => {
      const sp = splitAddr(a.address);
      const info = tel.terminals?.[sp.id] ?? {};
      const pane = allPanes.find((p) => p.pane === a.pane);
      const st = a.status;
      const isFoc = Boolean(a.focused);
      const hasCnf = (info.conflicts?.length ?? 0) > 0;
      const proj = info.work_dir || (pane?.cwd && pane.cwd !== home() ? baseName(pane.cwd) : "~");
      const files = (info.working_files ?? []).slice(0, 3);
      const topCall = (info.live_calls ?? [])[0];
      const pct = info.ctx_pct ?? 0;
      const usdStr = fmtUsd(info.usage_total?.est_usd);

      const badgeBg =
        st === "blocked" ? t.blocked : st === "done" ? t.done : st === "working" ? t.working : t.raised;
      const badgeTxt =
        st === "blocked" ? "REVIEW" : st === "done" ? "UNREAD" : st === "working" ? "WORK" : "IDLE";

      return v_flex()
        .id(`mpl-card-${sp.id}`)
        .flex_1()
        .min_w(0)
        .bg(t.surface)
        .border(hasCnf || isFoc ? 2 : 1)
        .border_color(hasCnf ? t.blocked : isFoc ? "#191816" : t.border)
        .child(
          h_flex()
            .h(26)
            .px(8)
            .items_center()
            .justify_between()
            .bg(isFoc ? "#191816" : t.raised)
            .text_color(isFoc ? "#FAF8F4" : t.foreground)
            .child(
              h_flex()
                .gap(5)
                .items_center()
                .child(
                  div()
                    .font_family("Geist Mono")
                    .text_size(10)
                    .font_bold()
                    .child(`#${idx + 1} ${sp.id}`),
                )
                .child(
                  div()
                    .px(4)
                    .h(14)
                    .flex()
                    .items_center()
                    .bg(badgeBg)
                    .text_color(st === "idle" ? t.muted : "#FAF8F4")
                    .font_family("Geist Mono")
                    .text_size(8.5)
                    .font_bold()
                    .child(badgeTxt),
                )
                .when(hasCnf, (cEl) =>
                  cEl.child(
                    div()
                      .px(4)
                      .h(14)
                      .flex()
                      .items_center()
                      .bg(t.blocked)
                      .text_color("#FAF8F4")
                      .font_family("Geist Mono")
                      .text_size(8.5)
                      .font_bold()
                      .child("CONFLICT"),
                  ),
                ),
            )
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .child(
                  div()
                    .px(4)
                    .h(15)
                    .flex()
                    .items_center()
                    .bg(isFoc ? "#302E2A" : t.surface)
                    .border(1)
                    .border_color(isFoc ? "#4A4741" : t.border)
                    .font_family("Geist Mono")
                    .text_size(9)
                    .child(proj),
                )
                .when(Boolean(usdStr), (uEl) =>
                  uEl.child(
                    div()
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .text_color(isFoc ? "#C9C3B6" : t.muted)
                      .child(usdStr),
                  ),
                ),
            ),
        )
        .child(
          v_flex()
            .p(8)
            .gap(5)
            .child(
              div()
                .truncate()
                .text_size(11.5)
                .font_semibold()
                .text_color(t.foreground)
                .child(info.title || a.title || a.program?.name || sp.id),
            )
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .child(
                  h_flex()
                    .flex_1()
                    .h(4)
                    .bg(t.raised)
                    .child(
                      div()
                        .w(`${Math.max(2, Math.min(100, pct))}%`)
                        .h_full()
                        .bg(pct >= 80 ? t.blocked : t.foreground),
                    ),
                )
                .child(
                  div()
                    .font_family("Geist Mono")
                    .text_size(9)
                    .text_color(t.muted)
                    .child(`${fmtTok(info.ctx_tokens)} ${Math.round(pct)}%`),
                ),
            )
            .when(Boolean(topCall), (tcEl) =>
              tcEl.child(
                div()
                  .truncate()
                  .font_family("Geist Mono")
                  .text_size(9.5)
                  .text_color(topCall.state === "running" ? t.blocked : t.muted)
                  .child(`${topCall.badge}: ${topCall.target}`),
              ),
            )
            .when(files.length > 0, (fEl) =>
              fEl.child(
                h_flex()
                  .gap(4)
                  .flex_wrap()
                  .children(
                    files.map((wf) =>
                      div()
                        .px(4)
                        .h(15)
                        .flex()
                        .items_center()
                        .bg(t.chrome)
                        .border(1)
                        .border_color(t.border)
                        .font_family("Geist Mono")
                        .text_size(8.5)
                        .text_color(wf.writes > 0 ? t.working : t.muted)
                        .child(`${wf.writes > 0 ? "E" : "R"}:${wf.name}`),
                    ),
                  ),
              ),
            )
            .child(
              h_flex()
                .gap(5)
                .pt(2)
                .child(
                  div()
                    .id(`mpl-foc-${sp.id}`)
                    .px(6)
                    .h(18)
                    .flex()
                    .items_center()
                    .bg("#191816")
                    .text_color("#FAF8F4")
                    .font_family("Geist Mono")
                    .text_size(9)
                    .cursor_pointer()
                    .on_click(() => {
                      run("agent.focus", { terminal: a.address });
                      if (props()?.overlay) closeOverlay(props().overlay);
                    })
                    .child("Focus"),
                )
                .child(
                  div()
                    .id(`mpl-doc-${sp.id}`)
                    .px(6)
                    .h(18)
                    .flex()
                    .items_center()
                    .bg(t.raised)
                    .border(1)
                    .border_color(t.border)
                    .font_family("Geist Mono")
                    .text_size(9)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .on_click(async (_e, cx) => {
                      this.pinTid = sp.id;
                      this.tab = "planche";
                      this.selectedDocPath = null;
                      await this.syncPlancheDocs(cx);
                      cx.notify();
                    })
                    .child("Docs →"),
                )
                .when(Boolean(info.inferred_cwd && info.inferred_cwd !== home()), (wtEl) =>
                  wtEl.child(
                    div()
                      .id(`mpl-wt-${sp.id}`)
                      .px(6)
                      .h(18)
                      .flex()
                      .items_center()
                      .bg(t.surface)
                      .border(1)
                      .border_color(t.border)
                      .font_family("Geist Mono")
                      .text_size(9)
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click(() => {
                        const activeSp = spaces().find((s) => s.active);
                        openOverlay({
                          mod: "worktree",
                          kind: "dialog",
                          width: 460,
                          height: 280,
                          props: { space: activeSp?.id, folder: info.inferred_cwd, action: "new" },
                        });
                      })
                      .child("+ Worktree"),
                  ),
                ),
            ),
        );
    });

    const rows = [];
    for (let i = 0; i < cards.length; i += 2) {
      rows.push(
        h_flex()
          .gap(8)
          .items_stretch()
          .child(cards[i])
          .child(cards[i + 1] ?? div().flex_1()),
      );
    }

    return v_flex()
      .id("mpl-wall-scroll")
      .flex_1()
      .min_h(0)
      .p(10)
      .gap(10)
      .overflow_y_scrollbar()
      .when(conflicts.length > 0, (el) =>
        el.child(
          v_flex()
            .p(8)
            .gap(3)
            .bg("#F5E6E3")
            .border(1)
            .border_color(t.blocked)
            .child(
              div()
                .font_family("Geist Mono")
                .text_size(10)
                .font_bold()
                .text_color(t.blocked)
                .child(`⚠ WRITE COLLISION DETECTED (${conflicts.length})`),
            )
            .children(
              conflicts.map((c) =>
                div()
                  .font_family("Geist Mono")
                  .text_size(9.5)
                  .text_color(t.foreground)
                  .child(`${c.kind.toUpperCase()} "${c.target}" touched concurrently by ${(c.terminals || []).join(", ")}`),
              ),
            ),
        ),
      )
      .when(cards.length === 0, (el) =>
        el.child(div().p(12).text_size(11.5).text_color(t.muted).child("No active coding agents. Use Blueprints or pick a repo below.")),
      )
      .children(rows)
      .when(idleRepos.length > 0, (el) =>
        el.child(
          v_flex()
            .p(8)
            .gap(6)
            .bg(t.surface)
            .border(1)
            .border_color(t.border)
            .child(
              div()
                .font_family("Geist Mono")
                .text_size(9.5)
                .font_semibold()
                .text_color(t.muted)
                .child("IDLE REPOS · CLICK TO SPAWN AGENT TAB"),
            )
            .child(
              h_flex()
                .gap(5)
                .flex_wrap()
                .children(
                  idleRepos.map((rp, ri) =>
                    div()
                      .id(`mpl-idle-${ri}`)
                      .px(6)
                      .h(20)
                      .flex()
                      .items_center()
                      .bg(t.raised)
                      .border(1)
                      .border_color(t.border)
                      .font_family("Geist Mono")
                      .text_size(9.5)
                      .cursor_pointer()
                      .hover((s) => s.bg("#191816").text_color("#FAF8F4"))
                      .on_click(() =>
                        run("tab.new", {
                          name: rp.name,
                          folder: rp.path,
                          ...(this.defaultArgv ? { argv: this.defaultArgv } : {}),
                        }),
                      )
                      .child(`+ ${rp.name}`),
                  ),
                ),
            ),
        ),
      );
  }

  renderPlanche(t, tel, cx) {
    const { tid, term } = this.resolveTargetAgent(tel);
    const terms = Object.values(tel.terminals ?? {});
    const blocks = parseMarkdownBlocks(this.docText);
    const workDir = term?.inferred_cwd || home();

    return v_flex()
      .flex_1()
      .min_h(0)
      .child(
        // Agent & Doc selector strip
        h_flex()
          .px(10)
          .py(6)
          .gap(6)
          .flex_none()
          .flex_wrap()
          .items_center()
          .bg(t.surface)
          .border_b(1)
          .border_color(t.border)
          .child(
            div()
              .id("mpl-pin-auto")
              .px(5)
              .h(18)
              .flex()
              .items_center()
              .bg(!this.pinTid ? "#191816" : t.raised)
              .text_color(!this.pinTid ? "#FAF8F4" : t.muted)
              .font_family("Geist Mono")
              .text_size(9)
              .cursor_pointer()
              .on_click(async (_e, cx) => {
                this.pinTid = null;
                this.selectedDocPath = null;
                await this.syncPlancheDocs(cx);
                cx.notify();
              })
              .child("AUTO"),
          )
          .children(
            terms.map((tm) => {
              const sel = tid === tm.terminal && Boolean(this.pinTid);
              return div()
                .id(`mpl-pin-${tm.terminal}`)
                .px(5)
                .h(18)
                .flex()
                .items_center()
                .bg(sel ? "#191816" : t.raised)
                .text_color(sel ? "#FAF8F4" : t.foreground)
                .font_family("Geist Mono")
                .text_size(9)
                .cursor_pointer()
                .on_click(async (_e, cx) => {
                  this.pinTid = tm.terminal;
                  this.selectedDocPath = null;
                  await this.syncPlancheDocs(cx);
                  cx.notify();
                })
                .child(`${tm.terminal}${tm.work_dir ? ` · ${tm.work_dir}` : ""}`);
            }),
          ),
      )
      .when(this.repoDocs.length > 0, (el) =>
        el.child(
          h_flex()
            .px(10)
            .py(5)
            .gap(5)
            .flex_none()
            .flex_wrap()
            .bg(t.chrome)
            .border_b(1)
            .border_color(t.border)
            .children(
              this.repoDocs.map((d, di) => {
                const act = this.selectedDocPath === d.path;
                return div()
                  .id(`mpl-d-${di}`)
                  .px(6)
                  .h(18)
                  .flex()
                  .items_center()
                  .bg(act ? t.done : t.surface)
                  .border(1)
                  .border_color(act ? t.done : t.border)
                  .text_color(act ? "#FAF8F4" : t.foreground)
                  .font_family("Geist Mono")
                  .text_size(9.5)
                  .cursor_pointer()
                  .on_click(async (_e, cx) => {
                    this.selectedDocPath = d.path;
                    await this.syncPlancheDocs(cx);
                    cx.notify();
                  })
                  .child(`${d.kind} · ${d.name}`);
              }),
            ),
        ),
      )
      .child(
        v_flex()
          .id("mpl-doc-scroll")
          .flex_1()
          .min_h(0)
          .p(12)
          .gap(6)
          .overflow_y_scrollbar()
          .when(this.thumbs.length > 0, (tEl) =>
            tEl.child(
              h_flex()
                .gap(8)
                .pb(8)
                .flex_wrap()
                .border_b(1)
                .border_color(t.border)
                .children(
                  this.thumbs.map((th, ti) =>
                    v_flex()
                      .id(`mpl-th-${ti}`)
                      .w(140)
                      .bg(t.surface)
                      .border(1)
                      .border_color(t.border)
                      .cursor_pointer()
                      .hover((s) => s.border_color(t.foreground))
                      .tooltip(`Open ${th.path}`)
                      .on_click(() => {
                        if (!checking()) exec("open", [th.path]).catch(() => {});
                      })
                      .child(image(th.rel).w_full().h(78))
                      .child(
                        div()
                          .px(5)
                          .py(3)
                          .truncate()
                          .font_family("Geist Mono")
                          .text_size(8.5)
                          .text_color(t.muted)
                          .child(th.name),
                      ),
                  ),
                ),
            ),
          )
          .when(blocks.length === 0, (el) =>
            el.child(
              div()
                .py(16)
                .text_size(11.5)
                .text_color(t.dim)
                .child("No plan/walkthrough or repository markdown doc found for this session yet."),
            ),
          )
          .children(
            blocks.map((b, bi) => {
              if (b.kind === "h1") {
                return div().pt(4).text_size(15).font_bold().text_color(t.foreground).child(b.text);
              }
              if (b.kind === "h2") {
                return div().pt(6).pb(2).border_b(1).border_color(t.border).text_size(13).font_semibold().text_color(t.foreground).child(b.text);
              }
              if (b.kind === "h3") {
                return div().pt(3).text_size(11.5).font_semibold().text_color(t.muted).child(b.text);
              }
              if (b.kind === "code") {
                return div()
                  .p(8)
                  .bg(t.surface)
                  .border(1)
                  .border_color(t.border)
                  .font_family("Geist Mono")
                  .text_size(10)
                  .text_color(t.foreground)
                  .child(b.text);
              }
              if (b.kind === "quote") {
                return div()
                  .pl(8)
                  .py(3)
                  .border_l(2)
                  .border_color(t.done)
                  .bg(t.surface)
                  .text_size(11)
                  .text_color(t.muted)
                  .child(b.text);
              }
              if (b.kind === "todo") {
                return h_flex()
                  .gap(8)
                  .py(3)
                  .px(6)
                  .items_center()
                  .justify_between()
                  .bg(t.surface)
                  .border(1)
                  .border_color(t.border)
                  .child(
                    div()
                      .flex_1()
                      .min_w(0)
                      .text_size(11)
                      .text_color(b.done ? t.dim : t.foreground)
                      .child(`${b.done ? "[✓]" : "[ ]"} ${b.text}`),
                  )
                  .when(!b.done, (sEl) =>
                    sEl.child(
                      div()
                        .id(`mpl-spw-${bi}`)
                        .px(6)
                        .h(18)
                        .flex_none()
                        .flex()
                        .items_center()
                        .bg("#191816")
                        .text_color("#FAF8F4")
                        .font_family("Geist Mono")
                        .text_size(8.5)
                        .font_semibold()
                        .cursor_pointer()
                        .hover((s) => s.bg(t.done))
                        .on_click(() => {
                          run("tab.new", {
                            name: b.text.slice(0, 18),
                            folder: workDir,
                            ...(this.defaultArgv ? { argv: this.defaultArgv } : {}),
                            task: b.text,
                          });
                        })
                        .child("Spawn ↗"),
                    ),
                  );
              }
              if (b.kind === "bullet") {
                return div().pl(8).text_size(11).text_color(t.foreground).child(`• ${b.text}`);
              }
              return div().text_size(11).text_color(t.foreground).child(b.text);
            }),
          ),
      );
  }

  renderPorts(t, tel, cx) {
    const portCounts = {};
    for (const p of this.ports) {
      portCounts[p.port] = (portCounts[p.port] || 0) + 1;
    }
    const termByCwd = {};
    for (const tm of Object.values(tel.terminals ?? {})) {
      if (tm.inferred_cwd) termByCwd[tm.inferred_cwd] = tm.terminal;
    }

    return v_flex()
      .id("mpl-ports-scroll")
      .flex_1()
      .min_h(0)
      .p(10)
      .gap(6)
      .overflow_y_scrollbar()
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .pb(4)
          .child(
            div()
              .font_family("Geist Mono")
              .text_size(10)
              .font_semibold()
              .text_color(t.muted)
              .child(`ACTIVE LISTENING PORTS (${this.ports.length})`),
          )
          .child(
            div()
              .id("mpl-ports-ref")
              .px(6)
              .h(18)
              .flex()
              .items_center()
              .bg(t.surface)
              .border(1)
              .border_color(t.border)
              .font_family("Geist Mono")
              .text_size(9)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click(() => this.pollPorts(cx))
              .child("Refresh"),
          ),
      )
      .when(this.ports.length === 0, (el) =>
        el.child(div().p(12).text_size(11).text_color(t.dim).child("No user dev-server ports (1024-65535) listening right now.")),
      )
      .children(
        this.ports.map((p, idx) => {
          const dup = portCounts[p.port] > 1;
          const matchedTid = termByCwd[p.cwd] || "";
          const dirName = p.cwd ? baseName(p.cwd) : "";
          return h_flex()
            .id(`mpl-pt-${idx}`)
            .px(10)
            .py(7)
            .gap(8)
            .items_center()
            .justify_between()
            .bg(t.surface)
            .border(1)
            .border_color(dup ? t.blocked : t.border)
            .child(
              h_flex()
                .gap(8)
                .items_center()
                .child(
                  div()
                    .px(5)
                    .h(18)
                    .flex()
                    .items_center()
                    .bg(dup ? t.blocked : "#191816")
                    .text_color("#FAF8F4")
                    .font_family("Geist Mono")
                    .text_size(10)
                    .font_bold()
                    .child(`:${p.port}`),
                )
                .child(
                  div()
                    .font_family("Geist Mono")
                    .text_size(10.5)
                    .font_semibold()
                    .child(p.cmd || "proc"),
                )
                .when(Boolean(dirName), (dEl) =>
                  dEl.child(
                    div()
                      .px(4)
                      .h(16)
                      .flex()
                      .items_center()
                      .bg(t.raised)
                      .font_family("Geist Mono")
                      .text_size(9)
                      .text_color(t.muted)
                      .child(matchedTid ? `${matchedTid} · ${dirName}` : dirName),
                  ),
                ),
            )
            .child(
              div()
                .id(`mpl-open-${idx}`)
                .px(7)
                .h(20)
                .flex()
                .items_center()
                .bg(t.raised)
                .border(1)
                .border_color(t.border)
                .font_family("Geist Mono")
                .text_size(9.5)
                .cursor_pointer()
                .hover((s) => s.bg("#191816").text_color("#FAF8F4"))
                .on_click(() => {
                  if (!checking()) exec("open", [`http://localhost:${p.port}`]).catch(() => {});
                })
                .child("Open ↗"),
            );
        }),
      );
  }

  render(cx) {
    const t = theme();
    const store = shared(KEY_TEL) ?? {};
    const tel = store.__local__ ?? {};
    const isOverlay = Boolean(props()?.overlay);

    const tabBtn = (id, label) => {
      const act = this.tab === id;
      return div()
        .id(`mpl-t-${id}`)
        .px(7)
        .h(18)
        .flex()
        .items_center()
        .bg(act ? "#191816" : t.surface)
        .border(1)
        .border_color(act ? "#191816" : t.border)
        .text_color(act ? "#FAF8F4" : t.muted)
        .font_family("Geist Mono")
        .text_size(9.5)
        .font_semibold()
        .cursor_pointer()
        .on_click(async (_e, cx) => {
          this.tab = id;
          if (id === "planche") await this.syncPlancheDocs(cx);
          if (id === "ports") await this.pollPorts(cx);
          cx.notify();
        })
        .child(label);
    };

    return v_flex()
      .id("modulor-planche")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(30)
          .px(10)
          .flex_none()
          .items_center()
          .justify_between()
          .bg(t.raised)
          .border_b(1)
          .border_color(t.border)
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(div().font_family("Geist Mono").text_size(10.5).font_bold().child("PLANCHE"))
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(tabBtn("wall", "WALL"))
                  .child(tabBtn("planche", "DOCS"))
                  .child(tabBtn("ports", "PORTS")),
              ),
          )
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                div()
                  .id("mpl-bp")
                  .px(6)
                  .h(18)
                  .flex()
                  .items_center()
                  .bg(t.surface)
                  .border(1)
                  .border_color(t.border)
                  .font_family("Geist Mono")
                  .text_size(9.5)
                  .cursor_pointer()
                  .hover((s) => s.bg("#191816").text_color("#FAF8F4"))
                  .on_click(() => run("modulor-bar.blueprints"))
                  .child("Blueprints"),
              )
              .when(isOverlay, (el) =>
                el.child(
                  div()
                    .id("mpl-esc")
                    .px(5)
                    .h(18)
                    .flex()
                    .items_center()
                    .cursor_pointer()
                    .font_family("Geist Mono")
                    .text_size(10)
                    .text_color(t.muted)
                    .hover((s) => s.bg(t.hover).text_color(t.foreground))
                    .on_click(() => closeOverlay(props().overlay))
                    .child("ESC"),
                ),
              ),
          ),
      )
      .when(this.tab === "wall", (el) => el.child(this.renderWall(t, tel, cx)))
      .when(this.tab === "planche", (el) => el.child(this.renderPlanche(t, tel, cx)))
      .when(this.tab === "ports", (el) => el.child(this.renderPorts(t, tel, cx)));
  }
}
