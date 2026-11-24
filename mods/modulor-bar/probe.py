#!/usr/bin/env python3
"""Read-only telemetry, multi-account quota, and workspace context probe for Modulor."""
import datetime
import json
import os
import re
import shlex
import sqlite3
import subprocess
import time
from pathlib import Path

HOME = Path.home()
AGY_HOME = HOME / ".gemini" / "antigravity-cli"
CACHE_DIR = HOME / ".cache" / "herdr-modulor"
CTX_CACHE_FILE = CACHE_DIR / "ctx-cache.json"
QUOTA_HIST_FILE = CACHE_DIR / "quota-history.jsonl"
USAGE_LEDGER_FILE = CACHE_DIR / "usage-ledger.json"
PRICES_FILE = CACHE_DIR / "prices.json"
_MEM_DB_ENV = os.environ.get("MODULOR_MEMORY_DB", "").strip()
MEMORY_DB = Path(_MEM_DB_ENV).expanduser() if _MEM_DB_ENV else None
LOCK_RE = re.compile(r"/presence/([0-9a-f-]{36})\.lock$")
CONV_ID_RE = re.compile(r'"conversationId"\s*:\s*"([0-9a-f-]{36})"')
UUID_DIR_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
AUTH_RE = re.compile(r"applyAuthResult:\s*email=([^,\s]+),\s*authMethod=([^,\s]*)")
TID_RE = re.compile(r"(?:^|\s)HC_TERMINAL_ID=(\S+)")
MEM_TOOL_PREFIXES = ("memory_", "ontology_", "mcp_agentmemory_")
INTERNAL_SUBPATHS = (
    "/.gemini/antigravity-cli/brain/",
    "/.gemini/skills/",
    "/.cache/",
)
SYSTEM_PREFIXES = (
    "/dev/",
    "/usr/",
    "/opt/",
    "/System/",
    "/var/folders/",
)
STOPWORDS = {
    "users", "home", "projects", "external", "workspaces", "config", "herdr",
    "app", "mods", "src", "lib", "dist", "build", "main", "index", "test",
    "tests", "spec", "json", "jsonl", "yaml", "yml", "toml", "md", "txt",
    "py", "js", "ts", "tsx", "jsx", "rs", "go", "sh", "file", "files", "path",
    "line", "lines", "start", "end", "code", "work", "task", "step", "steps",
    "edit", "read", "write", "run", "command", "tool", "agent", "agents",
    "panel", "panels", "check", "update", "create", "fix", "with", "from",
    "that", "this", "into", "when", "only", "the", "and", "for", "not", "all",
    "are", "was", "were", "have", "has", "can", "will", "should", "you",
    "your", "our", "out", "new", "use", "using", "current", "system", "local",
    "generated", "logs", "transcript", "status", "true", "false", "none",
    "dev", "null", "bash", "zsh", "output", "python3", "grep",
}



def parse_iso_epoch(ts):
    if not ts or not isinstance(ts, str):
        return None
    s = ts.strip()
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        elif " " in s and "T" not in s:
            s = s.replace(" ", "T", 1)
            if "+" not in s and "-" not in s[10:]:
                s += "+00:00"
        dt = datetime.datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.timestamp()
    except Exception:
        return None


def agy_home_roots():
    roots = {str(AGY_HOME)}
    try:
        roots.add(str(AGY_HOME.resolve()))
    except OSError:
        pass
    return tuple(roots)


def find_agy_pids():
    if os.path.isdir("/proc"):
        out = []
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            try:
                comm = Path(f"/proc/{entry}/comm").read_text().strip()
                if comm in ("agy", "antigravity"):
                    out.append(entry)
            except OSError:
                pass
        return out
    try:
        res = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True, timeout=3)
        pids = []
        for line in res.stdout.splitlines():
            s = line.strip()
            if not s or "probe.py" in s or "herdr-app" in s:
                continue
            parts = s.split(None, 2)
            if len(parts) < 2:
                continue
            pid = parts[0]
            cmd0 = os.path.basename(parts[1])
            matched = cmd0 in ("agy", "antigravity")
            if not matched and len(parts) >= 3 and cmd0.lower().startswith(("python", "node", "sh", "zsh", "bash")):
                toks = parts[2].split()
                if toks and os.path.basename(toks[0]) in ("agy", "antigravity"):
                    matched = True
            if matched and pid not in pids:
                pids.append(pid)
        return pids
    except Exception:
        return []


def collect_pid_env_and_files(pids):
    tids = {}
    locks = {}
    logs = {}
    if not pids:
        return tids, locks, logs

    roots = agy_home_roots()

    def in_home_agy(p):
        return any(p.startswith(r + "/") for r in roots)

    if os.path.isdir("/proc"):
        for pid in pids:
            try:
                raw = Path(f"/proc/{pid}/environ").read_bytes()
                for kv in raw.split(b"\0"):
                    if kv.startswith(b"HC_TERMINAL_ID="):
                        tids[pid] = kv.split(b"=", 1)[1].decode("utf-8", "ignore")
                        break
            except OSError:
                pass
            try:
                for fd in os.listdir(f"/proc/{pid}/fd"):
                    try:
                        target = os.readlink(f"/proc/{pid}/fd/{fd}")
                    except OSError:
                        continue
                    if not in_home_agy(target):
                        continue
                    m = LOCK_RE.search(target)
                    if m:
                        locks[pid] = m.group(1)
                    elif "/log/cli-" in target and target.endswith(".log"):
                        logs.setdefault(pid, []).append(target)
            except OSError:
                pass
        return tids, locks, logs

    pid_arg = ",".join(pids)
    try:
        res = subprocess.run(["ps", "-wwE", "-p", pid_arg, "-o", "pid=,command="], capture_output=True, text=True, timeout=3)
        for line in res.stdout.splitlines():
            s = line.strip()
            if not s:
                continue
            parts = s.split(None, 1)
            pid = parts[0]
            m = TID_RE.search(line)
            if m:
                tids[pid] = m.group(1)
    except Exception:
        pass

    try:
        res = subprocess.run(["lsof", "-nP", "-p", pid_arg, "-Fn"], capture_output=True, text=True, timeout=3)
        cur = None
        for line in res.stdout.splitlines():
            if line.startswith("p"):
                cur = line[1:]
            elif line.startswith("n") and cur:
                path = line[1:]
                if not in_home_agy(path):
                    continue
                m = LOCK_RE.search(path)
                if m:
                    locks[cur] = m.group(1)
                elif "/log/cli-" in path and path.endswith(".log"):
                    logs.setdefault(cur, []).append(path)
    except Exception:
        pass
    return tids, locks, logs


def email_from_logs(log_paths):
    if not log_paths:
        return None, None
    # Check newest logs first
    unique = sorted(set(log_paths), reverse=True)
    for lp in unique:
        try:
            p = Path(lp)
            sz = p.stat().st_size
            with p.open("rb") as f:
                if sz > 131072:
                    f.seek(sz - 131072)
                chunk = f.read().decode("utf-8", "ignore")
            matches = AUTH_RE.findall(chunk)
            if matches:
                email, method = matches[-1]
                return email.strip().lower(), method.strip() or None
        except OSError:
            pass
    return None, None


def summaries_for(cids):
    out = {}
    if not cids:
        return out
    db_path = AGY_HOME / "conversation_summaries.db"
    if not db_path.exists():
        return out
    try:
        db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=0.5)
        ph = ",".join("?" for _ in cids)
        rows = db.execute(
            f"SELECT conversation_id, title, step_count, status FROM conversation_summaries WHERE conversation_id IN ({ph})",
            list(cids),
        ).fetchall()
        db.close()
        for cid, title, steps, status in rows:
            out[cid] = {"title": title or "", "steps": steps or 0, "status": status or ""}
    except sqlite3.Error:
        pass
    return out


def unquote_arg(v):
    if v is None:
        return ""
    if isinstance(v, str):
        s = v.strip()
        if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
            try:
                dec = json.loads(s)
                if isinstance(dec, str):
                    return dec
            except Exception:
                return s[1:-1]
        return v
    return str(v)


def extract_mem_target(tool_name, args):
    if not isinstance(args, dict):
        return ""
    for key in ("query", "label", "title", "id", "type", "text", "content", "message"):
        val = unquote_arg(args.get(key))
        if val.strip():
            return val.strip().replace("\n", " ")[:90]
    return ""


def shorten_path(fpath):
    if not fpath:
        return ""
    s = str(fpath)
    home_s = str(HOME)
    if s.startswith(home_s + "/"):
        return "~/" + s[len(home_s) + 1:]
    return s


def is_ignored_work_path(fpath):
    if not fpath or not fpath.startswith("/"):
        return True
    if fpath.startswith(SYSTEM_PREFIXES) or fpath == "/dev":
        return True
    for pat in INTERNAL_SUBPATHS:
        if pat in fpath:
            return True
    return False


def find_git_root(path_str):
    if not path_str or not isinstance(path_str, str) or not path_str.startswith("/"):
        return None
    try:
        p = Path(path_str)
        cur = p if p.is_dir() else p.parent
        home_res = str(HOME.resolve())
        fallback_home = None
        for _ in range(9):
            try:
                if (cur / ".git").exists():
                    s_cur = str(cur)
                    if s_cur == home_res:
                        fallback_home = s_cur
                    else:
                        return s_cur
            except OSError:
                break
            if cur == cur.parent or str(cur) == "/":
                break
            cur = cur.parent
        return fallback_home
    except OSError:
        return None


def extract_cmd_paths(cmd):
    out = []
    if not cmd:
        return out
    try:
        toks = shlex.split(cmd[:500])
    except ValueError:
        toks = cmd[:500].split()
    for i, tok in enumerate(toks):
        if tok in ("cd", "-C") and i + 1 < len(toks) and toks[i + 1].startswith("/"):
            out.append(toks[i + 1])
        elif tok.startswith("/") and len(tok) > 4 and " " not in tok:
            out.append(tok)
    return out


def classify_tool_call(name, args):
    if not isinstance(args, dict):
        args = {}
    if name == "read_file" or name == "view_file":
        fpath = unquote_arg(args.get("Path") or args.get("TargetFile"))
        bn = os.path.basename(fpath) if fpath else "file"
        sl = unquote_arg(args.get("StartLine"))
        el = unquote_arg(args.get("EndLine"))
        suffix = f":{sl}-{el}" if (sl and el) else (f":{sl}" if sl else "")
        return "read", "READ", f"{bn}{suffix}", shorten_path(fpath), fpath
    if name in ("edit_file", "replace_file_content", "multi_replace_file_content"):
        fpath = unquote_arg(args.get("Path") or args.get("TargetFile"))
        bn = os.path.basename(fpath) if fpath else "file"
        return "edit", "EDIT", bn, shorten_path(fpath), fpath
    if name == "write_file":
        fpath = unquote_arg(args.get("Path") or args.get("TargetFile"))
        bn = os.path.basename(fpath) if fpath else "file"
        return "write", "WRITE", bn, shorten_path(fpath), fpath
    if name == "run_command":
        summary = unquote_arg(args.get("toolSummary")).strip()
        cmd = " ".join(unquote_arg(args.get("CommandLine")).split())
        tgt = summary or (cmd[:52] + ("..." if len(cmd) > 52 else ""))
        return "exec", "EXEC", tgt or "command", cmd[:180], ""
    if name in ("find_by_name", "grep_search", "list_dir"):
        q = unquote_arg(args.get("Query") or args.get("Pattern") or args.get("SearchPath") or args.get("DirectoryPath"))
        sp = unquote_arg(args.get("SearchPath") or args.get("DirectoryPath"))
        bn = os.path.basename(sp.rstrip("/")) if sp else ""
        tgt = f"{q[:34]} @ {bn}" if (q and bn and q != sp) else (bn or shorten_path(q)[:46])
        return "find", "FIND", tgt or name, shorten_path(sp or q), sp
    if name in ("search_web", "read_url_content"):
        q = unquote_arg(args.get("query") or args.get("Url") or args.get("url"))
        return "web", "WEB", q[:48], q[:180], ""
    if name in ("invoke_subagent", "send_message", "manage_subagents", "swarm", "run_workflow"):
        tgt = unquote_arg(args.get("Role") or args.get("TypeName") or args.get("Recipient") or args.get("Description") or args.get("name") or args.get("action")) or name
        return "agent", "AGENT", tgt[:46], tgt[:160], ""
    if name == "call_mcp_tool" or name.startswith(MEM_TOOL_PREFIXES):
        inner = unquote_arg(args.get("ToolName")) or name.replace("mcp_agentmemory_", "")
        raw_args = args.get("Arguments")
        inner_args = raw_args if isinstance(raw_args, dict) else args
        if isinstance(raw_args, str):
            raw_dec = unquote_arg(raw_args)
            try:
                parsed = json.loads(raw_dec)
                if isinstance(parsed, dict):
                    inner_args = parsed
            except Exception:
                inner_args = {}
        srv = unquote_arg(args.get("ServerName")) or "mcp"
        mt = extract_mem_target(inner, inner_args)
        tgt = f"{inner}: {mt}" if mt else inner
        return "mcp", "MCP", tgt[:50], f"{srv} / {tgt}"[:160], ""
    if name in ("list_resources", "read_resource"):
        uri = unquote_arg(args.get("Uri") or args.get("ServerName")) or name
        return "mcp", "RES", uri[:48], uri[:160], ""
    if name in ("ask_question", "enter_plan_mode", "schedule", "manage_task"):
        tgt = unquote_arg(args.get("reason") or args.get("Action") or args.get("Prompt")) or name
        return "flow", "FLOW", tgt.replace("\n", " ")[:46], tgt[:160], ""
    tgt = extract_mem_target(name, args)
    return "other", name[:5].upper(), tgt or name, tgt, ""


def parse_transcript_tail(cid, tid, now):
    tp = AGY_HOME / "brain" / cid / ".system_generated" / "logs" / "transcript.jsonl"
    info = {
        "ctx_tokens": None,
        "in_tokens": 0,
        "cache_tokens": 0,
        "out_tokens": 0,
        "model": None,
        "last_step_at": None,
        "activations": [],
        "live_calls": [],
        "working_files": [],
        "active_skills": [],
        "artifacts": [],
        "artifact_items": [],
        "mcp_queries": [],
        "subagents": [],
        "inferred_cwd": None,
        "work_dir": None,
        "agent_busy": False,
    }
    if not tp.exists():
        return info
    try:
        sz = tp.stat().st_size
        with tp.open("rb") as f:
            if sz > 327680:
                f.seek(sz - 327680)
                f.readline()  # discard partial first line
            lines = f.read().decode("utf-8", "ignore").splitlines()
    except OSError:
        return info

    latest_ctx = None
    sum_in = 0
    sum_cache = 0
    sum_out = 0
    latest_model = None
    last_ts = None
    activations = []
    calls = []
    pending_idxs = []
    subagents = []
    subagent_by_call = {}
    files_map = {}
    skills_seen = {}
    artifacts_seen = {}
    mcp_queries = []
    cmd_paths_recent = []
    project_paths_recent = []

    for ln in lines:
        if not ln.strip():
            continue
        try:
            d = json.loads(ln)
        except Exception:
            continue
        typ = d.get("type") or ""
        ts_str = d.get("created_at")
        ep = parse_iso_epoch(ts_str)
        age = max(0, int(now - ep)) if ep else 999999
        if ts_str:
            last_ts = ts_str
        if d.get("model"):
            latest_model = d.get("model")
        in_tok = d.get("input_tokens")
        cache_tok = d.get("cache_read_tokens") or 0
        out_tok = d.get("output_tokens") or 0
        if isinstance(in_tok, int) and in_tok > 0:
            latest_ctx = in_tok + (cache_tok if isinstance(cache_tok, int) else 0)
            sum_in += in_tok
            if isinstance(cache_tok, int):
                sum_cache += cache_tok
        if isinstance(out_tok, int):
            sum_out += out_tok

        if typ == "GENERIC":
            if pending_idxs:
                idx = pending_idxs.pop(0)
                gst = str(d.get("status") or "DONE").upper()
                if gst == "ERROR":
                    calls[idx]["state"] = "error"
                elif gst == "RUNNING":
                    calls[idx]["state"] = "running"
                else:
                    calls[idx]["state"] = "done"
                if idx in subagent_by_call:
                    sa = subagent_by_call[idx]
                    sa["state"] = calls[idx]["state"]
                    m_cid = CONV_ID_RE.search(str(d.get("content") or ""))
                    if m_cid:
                        sa["cid"] = m_cid.group(1)
            continue

        if typ == "PLANNER_RESPONSE":
            # Any prior turn calls never keep stale running indicator once a new turn begins
            for prev_idx in pending_idxs:
                if calls[prev_idx]["state"] == "running":
                    calls[prev_idx]["state"] = "done"
            for prev_call in calls:
                if prev_call["state"] == "running":
                    prev_call["state"] = "done"
            pending_idxs = []

        tcs = d.get("tool_calls") or []
        for tc in tcs:
            if not isinstance(tc, dict):
                continue
            name = tc.get("name") or ""
            args = tc.get("args") if isinstance(tc.get("args"), dict) else {}

            cat, badge, tgt, detail, fpath = classify_tool_call(name, args)
            call_obj = {
                "tool": name,
                "cat": cat,
                "badge": badge,
                "target": tgt,
                "detail": detail,
                "state": "running" if typ == "PLANNER_RESPONSE" else "done",
                "age_sec": age,
                "ts": ts_str,
            }
            calls.append(call_obj)
            call_idx = len(calls) - 1
            if typ == "PLANNER_RESPONSE":
                pending_idxs.append(call_idx)

            if name == "invoke_subagent":
                sa_obj = {
                    "kind": "subagent",
                    "role": unquote_arg(args.get("Role")) or unquote_arg(args.get("TypeName")) or "subagent",
                    "type_name": unquote_arg(args.get("TypeName")) or "",
                    "model": unquote_arg(args.get("Model")) or "",
                    "cid": None,
                    "state": call_obj["state"],
                    "age_sec": age,
                    "steps": 0,
                    "last_tool": None,
                    "busy": call_obj["state"] == "running",
                }
                subagents.append(sa_obj)
                subagent_by_call[call_idx] = sa_obj
            elif name == "swarm" and unquote_arg(args.get("action")) == "add":
                subagents.append({
                    "kind": "swarm",
                    "role": unquote_arg(args.get("name")) or "worker",
                    "type_name": unquote_arg(args.get("workspace")) or "inherit",
                    "model": unquote_arg(args.get("model")) or "",
                    "cid": None,
                    "state": call_obj["state"],
                    "age_sec": age,
                    "steps": 0,
                    "last_tool": unquote_arg(args.get("brief"))[:42] or None,
                    "busy": call_obj["state"] == "running",
                })

            # Track artifacts, skills, and hot working files
            if fpath:
                norm_p = fpath.rstrip("/")
                if "/skills/" in norm_p and (norm_p.endswith("/SKILL.md") or norm_p.endswith(".md")):
                    parts = norm_p.split("/skills/")[-1].split("/")
                    sk = parts[0] if parts else os.path.basename(norm_p)
                    if sk:
                        skills_seen[sk] = age
                elif args.get("ArtifactMetadata") or ("/.gemini/antigravity-cli/brain/" in norm_p and ".system_generated" not in norm_p):
                    abn = os.path.basename(norm_p)
                    if abn:
                        prev_art = artifacts_seen.get(abn)
                        if not prev_art or age <= prev_art[0]:
                            artifacts_seen[abn] = (age, norm_p)
                elif name in ("read_file", "view_file", "edit_file", "replace_file_content", "multi_replace_file_content", "write_file") and ".system_generated" not in norm_p:
                    op = "read" if name in ("read_file", "view_file") else ("write" if name == "write_file" else "edit")
                    ent = files_map.get(norm_p)
                    if not ent:
                        parent = os.path.dirname(norm_p)
                        short_dir = shorten_path(parent)
                        if len(short_dir) > 34:
                            dparts = [x for x in short_dir.split("/") if x]
                            short_dir = "/".join(dparts[-2:]) if len(dparts) >= 2 else short_dir
                        ent = {
                            "path": norm_p,
                            "name": os.path.basename(norm_p) or norm_p,
                            "dir": short_dir,
                            "reads": 0,
                            "writes": 0,
                            "ops": 0,
                            "last_op": op,
                            "age_sec": age,
                        }
                        files_map[norm_p] = ent
                    if op == "read":
                        ent["reads"] += 1
                    else:
                        ent["writes"] += 1
                    ent["ops"] += 1
                    ent["last_op"] = op
                    ent["age_sec"] = age
                    if not is_ignored_work_path(norm_p):
                        project_paths_recent.append((op != "read", norm_p))
            elif name in ("find_by_name", "grep_search", "list_dir"):
                sp = unquote_arg(args.get("SearchPath") or args.get("DirectoryPath")).rstrip("/")
                if sp and not is_ignored_work_path(sp):
                    project_paths_recent.append((False, sp))
            elif name == "run_command":
                for cp in extract_cmd_paths(unquote_arg(args.get("CommandLine"))):
                    if not is_ignored_work_path(cp):
                        cmd_paths_recent.append(cp)

            # Track agentmemory MCP & rule/memory file calls
            mem_tool = None
            mem_args = args
            srv_name = unquote_arg(args.get("ServerName"))
            if name == "call_mcp_tool" and srv_name == "agentmemory":
                mem_tool = unquote_arg(args.get("ToolName")) or "agentmemory"
                raw_inner = args.get("Arguments")
                if isinstance(raw_inner, dict):
                    mem_args = raw_inner
                elif isinstance(raw_inner, str):
                    try:
                        parsed = json.loads(unquote_arg(raw_inner))
                        mem_args = parsed if isinstance(parsed, dict) else {}
                    except Exception:
                        mem_args = {}
            elif name.startswith(MEM_TOOL_PREFIXES):
                mem_tool = name.replace("mcp_agentmemory_", "")
            elif name in ("read_file", "write_file", "edit_file"):
                fpath_m = unquote_arg(args.get("Path"))
                if "/memories/" in fpath_m or fpath_m.endswith(("/MEMORY.md", "/USER.md", "/AGENTS.md", "/CLAUDE.md")):
                    mem_tool = "memory_file"
                    mem_args = {"query": os.path.basename(fpath_m)}
            elif name == "run_command":
                cmd = unquote_arg(args.get("CommandLine"))
                if (
                    "agentmemory" in cmd
                    and "herdr-modulor" not in cmd
                    and "probe.py" not in cmd
                    and "PRAGMA" not in cmd
                    and "transcript.jsonl" not in cmd
                ):
                    mem_tool = "memory_cli"
                    mem_args = {"query": "agentmemory"}

            if mem_tool:
                low = mem_tool.lower()
                if "slot" in low:
                    kind = "slot"
                elif "ontology" in low or "graph" in low or "relation" in low:
                    kind = "graph"
                elif "save" in low or "create" in low or "update" in low or "consolidate" in low:
                    kind = "write"
                else:
                    kind = "recall"
                m_target = extract_mem_target(mem_tool, mem_args)
                if m_target:
                    mcp_queries.append(m_target)
                activations.append({
                    "terminal": tid,
                    "cid": cid,
                    "ts": ts_str,
                    "age_sec": age,
                    "tool": mem_tool,
                    "kind": kind,
                    "target": m_target,
                })

    # Determine git repo / workspace root from most recent non-brain paths
    inferred_cwd = None
    fallback_home_git = None
    home_s = str(HOME.resolve())
    best_work_path = None
    candidates = [p for _, p in reversed(project_paths_recent)] + list(reversed(cmd_paths_recent))
    seen_roots = set()
    for cand in candidates:
        if best_work_path is None:
            best_work_path = cand
        gr = find_git_root(cand)
        if not gr or gr in seen_roots:
            continue
        seen_roots.add(gr)
        if gr != home_s:
            inferred_cwd = gr
            break
        elif fallback_home_git is None:
            fallback_home_git = gr
    if not inferred_cwd:
        inferred_cwd = fallback_home_git

    work_dir = None
    if inferred_cwd and inferred_cwd != home_s:
        work_dir = os.path.basename(inferred_cwd)
    elif best_work_path:
        # Compact folder label e.g. '.config/herdr-app' or 'packages/core'
        rel = shorten_path(os.path.dirname(best_work_path) if os.path.isfile(best_work_path) or "." in os.path.basename(best_work_path) else best_work_path)
        parts = [x for x in rel.replace("~/", "").split("/") if x]
        work_dir = "/".join(parts[:2]) if parts else os.path.basename(inferred_cwd or "")

    working_files = sorted(
        files_map.values(),
        key=lambda x: (x["age_sec"], -x["writes"], -x["ops"]),
    )[:8]
    active_skills = [k for k, _ in sorted(skills_seen.items(), key=lambda kv: kv[1])][:5]
    sorted_arts = sorted(artifacts_seen.items(), key=lambda kv: kv[1][0])[:5]
    artifacts = [k for k, _ in sorted_arts]
    artifact_items = [{"name": k, "path": p, "age_sec": a} for k, (a, p) in sorted_arts]
    live_calls = list(reversed(calls[-10:]))
    agent_busy = any(c["state"] == "running" for c in live_calls)

    info["ctx_tokens"] = latest_ctx
    info["in_tokens"] = sum_in
    info["cache_tokens"] = sum_cache
    info["out_tokens"] = sum_out
    info["model"] = latest_model
    info["last_step_at"] = last_ts
    info["activations"] = list(reversed(activations[-10:]))
    info["live_calls"] = live_calls
    info["working_files"] = working_files
    info["active_skills"] = active_skills
    info["artifacts"] = artifacts
    info["artifact_items"] = artifact_items
    info["mcp_queries"] = mcp_queries[-6:]
    info["inferred_cwd"] = inferred_cwd
    info["work_dir"] = work_dir
    info["agent_busy"] = agent_busy

    dedup_sa = []
    seen_sa_cids = set()
    for sa in reversed(subagents):
        scid = sa.get("cid")
        if scid:
            if scid in seen_sa_cids:
                continue
            seen_sa_cids.add(scid)
            child = inspect_subagent_cid(scid, now)
            if child:
                sa.update(child)
        dedup_sa.append(sa)
        if len(dedup_sa) >= 8:
            break
    info["subagents"] = dedup_sa
    return info


def inspect_subagent_cid(child_cid, now):
    tp = AGY_HOME / "brain" / child_cid / ".system_generated" / "logs" / "transcript.jsonl"
    if not tp.exists():
        return None
    try:
        sz = tp.stat().st_size
        with tp.open("rb") as f:
            if sz > 98304:
                f.seek(sz - 98304)
                f.readline()
            lines = f.read().decode("utf-8", "ignore").splitlines()
    except OSError:
        return None
    steps = 0
    model = None
    last_ep = None
    last_tool = None
    pending = 0
    for ln in lines:
        if not ln.strip():
            continue
        try:
            d = json.loads(ln)
        except Exception:
            continue
        steps += 1
        if d.get("model"):
            model = d.get("model")
        ep = parse_iso_epoch(d.get("created_at"))
        if ep:
            last_ep = ep
        typ = d.get("type") or ""
        if typ == "GENERIC":
            if pending > 0:
                pending -= 1
        elif typ == "PLANNER_RESPONSE":
            tcs = d.get("tool_calls") or []
            pending = len(tcs)
            for tc in tcs:
                if isinstance(tc, dict):
                    _, badge, tgt, _, _ = classify_tool_call(tc.get("name") or "", tc.get("args") if isinstance(tc.get("args"), dict) else {})
                    last_tool = f"{badge} {tgt}"[:48]
    age = max(0, int(now - last_ep)) if last_ep else 0
    busy = pending > 0 and age < 180
    out = {
        "steps": steps,
        "age_sec": age,
        "busy": busy,
        "state": "running" if busy else "done",
    }
    if model:
        out["model"] = model
    if last_tool:
        out["last_tool"] = last_tool
    return out


def read_terminal_cache(tid):
    tf = CACHE_DIR / "terminals" / f"{tid}.json"
    if not tf.exists():
        return {}
    try:
        d = json.loads(tf.read_text())
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def normalize_accounts(active_emails, active_methods, now):
    store = {"latest_email": None, "accounts": {}}
    af = CACHE_DIR / "accounts.json"
    if af.exists():
        try:
            loaded = json.loads(af.read_text())
            if isinstance(loaded, dict):
                store["latest_email"] = loaded.get("latest_email")
                if isinstance(loaded.get("accounts"), dict):
                    store["accounts"] = loaded["accounts"]
        except Exception:
            pass

    normalized = {}
    all_emails = set(store["accounts"].keys()) | set(active_emails)
    for email in sorted(all_emails):
        raw_acct = store["accounts"].get(email) if isinstance(store["accounts"].get(email), dict) else {}
        raw_quota = raw_acct.get("quota") if isinstance(raw_acct.get("quota"), dict) else None
        buckets = None
        if raw_quota:
            buckets = {}
            for bk, bv in raw_quota.items():
                if not isinstance(bv, dict):
                    continue
                rf = bv.get("remaining_fraction")
                rt = bv.get("reset_time")
                rs = bv.get("reset_in_seconds")
                ep = parse_iso_epoch(rt)
                if ep is not None:
                    left = int(ep - now)
                    if left <= 0:
                        rf = 1.0
                        left = 0
                elif isinstance(rs, (int, float)):
                    age = max(0, int(now - (raw_acct.get("at") or now)))
                    left = max(0, int(rs - age))
                else:
                    left = None
                rem_pct = round(max(0.0, min(1.0, float(rf))) * 100.0, 1) if isinstance(rf, (int, float)) else None
                buckets[bk] = {
                    "remaining_pct": rem_pct,
                    "used_pct": round(100.0 - rem_pct, 1) if rem_pct is not None else None,
                    "reset_in_sec": left,
                    "reset_time": rt,
                    "disabled": bool(bv.get("disabled")),
                }
        normalized[email] = {
            "email": email,
            "plan": raw_acct.get("plan") or active_methods.get(email) or None,
            "at": raw_acct.get("at"),
            "active_panes": sum(1 for e in active_emails if e == email),
            "quota": buckets,
        }

    latest = store.get("latest_email")
    if latest not in normalized and active_emails:
        latest = active_emails[0]
    elif not latest and normalized:
        latest = next(iter(normalized.keys()))
    return normalized, latest


def detect_write_conflicts(terminals, now):
    """Detect concurrent file edits or shared non-worktree checkout mutations across live terminals."""
    home_s = str(HOME.resolve())
    file_writers = {}
    repo_writers = {}
    for tid, tinfo in terminals.items():
        tinfo["conflicts"] = []
        has_recent_write = False
        for wf in (tinfo.get("working_files") or []):
            if (wf.get("writes") or 0) > 0 and (wf.get("age_sec") or 999999) < 900:
                fp = wf.get("path")
                if fp:
                    file_writers.setdefault(fp, []).append((tid, wf.get("name") or os.path.basename(fp)))
                if (wf.get("age_sec") or 999999) < 600:
                    has_recent_write = True
        icwd = tinfo.get("inferred_cwd")
        if has_recent_write and icwd and icwd != home_s:
            repo_writers.setdefault(icwd, []).append((tid, tinfo.get("work_dir") or os.path.basename(icwd)))

    global_conflicts = []
    for fp, writers in file_writers.items():
        if len(writers) < 2:
            continue
        tids = [w[0] for w in writers]
        fname = writers[0][1]
        global_conflicts.append({"kind": "file", "target": fname, "path": fp, "terminals": tids})
        for tid in tids:
            peers = [x for x in tids if x != tid]
            terminals[tid]["conflicts"].append({"kind": "file", "target": fname, "path": fp, "peers": peers})

    for repo_path, writers in repo_writers.items():
        if len(writers) < 2:
            continue
        tids = [w[0] for w in writers]
        rname = writers[0][1]
        global_conflicts.append({"kind": "repo", "target": rname, "path": repo_path, "terminals": tids})
        for tid in tids:
            peers = [x for x in tids if x != tid]
            terminals[tid]["conflicts"].append({"kind": "repo", "target": rname, "path": repo_path, "peers": peers})

    for tinfo in terminals.values():
        tinfo["conflicts"] = tinfo["conflicts"][:4]
    return global_conflicts[:8]


DEFAULT_PRICES = {
    "opus": {"in": 5.0, "cache": 0.5, "out": 25.0},
    "sonnet": {"in": 3.0, "cache": 0.3, "out": 15.0},
    "flash-lite": {"in": 0.10, "cache": 0.025, "out": 0.40},
    "flash_lite": {"in": 0.10, "cache": 0.025, "out": 0.40},
    "flash": {"in": 0.30, "cache": 0.075, "out": 2.50},
    "default": {"in": 1.25, "cache": 0.31, "out": 10.0},
}


def load_prices():
    if not PRICES_FILE.exists():
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = PRICES_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(DEFAULT_PRICES, indent=2) + "\n")
            tmp.replace(PRICES_FILE)
        except OSError:
            pass
        return DEFAULT_PRICES
    try:
        loaded = json.loads(PRICES_FILE.read_text())
        if isinstance(loaded, dict):
            return {**DEFAULT_PRICES, **loaded}
    except Exception:
        pass
    return DEFAULT_PRICES


def price_for_model(model_name, prices):
    low = (model_name or "").lower()
    for key in ("opus", "sonnet", "flash-lite", "flash_lite", "flash"):
        if key in low and isinstance(prices.get(key), dict):
            return prices[key]
    return prices.get("default") or DEFAULT_PRICES["default"]


def estimate_usd(model_name, in_tok, cache_tok, out_tok, prices):
    p = price_for_model(model_name, prices)
    return (
        (in_tok * float(p.get("in", 1.25)))
        + (cache_tok * float(p.get("cache", 0.31)))
        + (out_tok * float(p.get("out", 10.0)))
    ) / 1_000_000.0


def update_usage_ledger(active_cids_meta, sums, prices, now):
    ledger = {"version": 1, "cids": {}}
    if USAGE_LEDGER_FILE.exists():
        try:
            loaded = json.loads(USAGE_LEDGER_FILE.read_text())
            if isinstance(loaded, dict) and isinstance(loaded.get("cids"), dict):
                ledger = loaded
        except Exception:
            pass

    cids_map = ledger["cids"]
    dirty = False
    brain_dir = AGY_HOME / "brain"
    candidates = dict(active_cids_meta)

    cutoff_7d = now - 7 * 86400
    recent_dirs = []
    if brain_dir.is_dir():
        try:
            for ent in os.scandir(brain_dir):
                if not ent.is_dir() or not UUID_DIR_RE.match(ent.name):
                    continue
                if ent.name in candidates:
                    continue
                tp = Path(ent.path) / ".system_generated" / "logs" / "transcript.jsonl"
                try:
                    st = tp.stat()
                except OSError:
                    continue
                if st.st_mtime >= cutoff_7d:
                    recent_dirs.append((st.st_mtime, ent.name, tp, st.st_size))
        except OSError:
            pass
    recent_dirs.sort(reverse=True)
    for _, rcid, _, _ in recent_dirs[:50]:
        if rcid not in candidates:
            candidates[rcid] = {"tid": None, "title": "", "model": None}

    missing_titles = [c for c, m in candidates.items() if not m.get("title") and not (cids_map.get(c) or {}).get("title")]
    extra_sums = summaries_for(set(missing_titles)) if missing_titles else {}

    local_tz = datetime.datetime.now().astimezone().tzinfo
    for cid, meta in candidates.items():
        tp = brain_dir / cid / ".system_generated" / "logs" / "transcript.jsonl"
        try:
            st = tp.stat()
        except OSError:
            continue
        ent = cids_map.get(cid)
        if not isinstance(ent, dict) or st.st_size < int(ent.get("offset", 0)):
            ent = {
                "offset": 0,
                "updated_at": 0,
                "title": "",
                "tid": "",
                "model": "",
                "in": 0,
                "cache": 0,
                "out": 0,
                "by_day": {},
            }
            cids_map[cid] = ent
            dirty = True

        title = meta.get("title") or (sums.get(cid) or {}).get("title") or (extra_sums.get(cid) or {}).get("title") or ent.get("title") or ""
        if title and title != ent.get("title"):
            ent["title"] = title
            dirty = True
        if meta.get("tid") and meta["tid"] != ent.get("tid"):
            ent["tid"] = meta["tid"]
            dirty = True
        if meta.get("model") and meta["model"] != ent.get("model"):
            ent["model"] = meta["model"]
            dirty = True

        off = int(ent.get("offset", 0))
        if st.st_size > off:
            try:
                with tp.open("rb") as f:
                    f.seek(off)
                    chunk = f.read()
                nl = chunk.rfind(b"\n")
                if nl >= 0:
                    complete = chunk[: nl + 1]
                    ent["offset"] = off + nl + 1
                    ent["updated_at"] = int(now)
                    dirty = True
                    for raw_ln in complete.decode("utf-8", "ignore").splitlines():
                        if not raw_ln.strip():
                            continue
                        try:
                            d = json.loads(raw_ln)
                        except Exception:
                            continue
                        mdl = d.get("model") or ent.get("model") or meta.get("model") or ""
                        if mdl:
                            ent["model"] = mdl
                        in_t = d.get("input_tokens")
                        ca_t = d.get("cache_read_tokens") or 0
                        ou_t = d.get("output_tokens") or 0
                        in_v = int(in_t) if isinstance(in_t, int) and in_t > 0 else 0
                        ca_v = int(ca_t) if isinstance(ca_t, int) and ca_t > 0 else 0
                        ou_v = int(ou_t) if isinstance(ou_t, int) and ou_t > 0 else 0
                        if in_v == 0 and ca_v == 0 and ou_v == 0:
                            continue
                        ent["in"] = int(ent.get("in", 0)) + in_v
                        ent["cache"] = int(ent.get("cache", 0)) + ca_v
                        ent["out"] = int(ent.get("out", 0)) + ou_v
                        ep = parse_iso_epoch(d.get("created_at"))
                        day_str = datetime.datetime.fromtimestamp(ep or st.st_mtime, tz=local_tz).strftime("%Y-%m-%d")
                        day_map = ent.setdefault("by_day", {})
                        d_ent = day_map.setdefault(day_str, {"in": 0, "cache": 0, "out": 0, "by_model": {}})
                        d_ent["in"] += in_v
                        d_ent["cache"] += ca_v
                        d_ent["out"] += ou_v
                        m_key = mdl or "default"
                        bm = d_ent.setdefault("by_model", {}).setdefault(m_key, [0, 0, 0])
                        bm[0] += in_v
                        bm[1] += ca_v
                        bm[2] += ou_v
            except OSError:
                pass

    cutoff_30d = now - 30 * 86400
    stale_cids = [k for k, v in cids_map.items() if k not in candidates and (v.get("updated_at") or 0) < cutoff_30d]
    for k in stale_cids:
        del cids_map[k]
        dirty = True

    if dirty:
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = USAGE_LEDGER_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(ledger, ensure_ascii=False, separators=(",", ":")))
            tmp.replace(USAGE_LEDGER_FILE)
        except OSError:
            pass

    today_dt = datetime.datetime.fromtimestamp(now, tz=local_tz).date()
    day_keys = [(today_dt - datetime.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6, -1, -1)]
    today_key = day_keys[-1]
    days_agg = {dk: {"date": dk, "in": 0, "cache": 0, "out": 0, "est_usd": 0.0, "sessions": set()} for dk in day_keys}

    usage_by_cid = {}
    session_rows = []
    for cid, ent in cids_map.items():
        total_usd = 0.0
        last_day = ""
        by_day = ent.get("by_day") or {}
        for dk, dv in by_day.items():
            if dk > last_day:
                last_day = dk
            d_usd = 0.0
            bm = dv.get("by_model") or {}
            if bm:
                for mk_name, vals in bm.items():
                    d_usd += estimate_usd(mk_name, vals[0], vals[1], vals[2], prices)
            else:
                d_usd = estimate_usd(ent.get("model"), dv.get("in", 0), dv.get("cache", 0), dv.get("out", 0), prices)
            total_usd += d_usd
            if dk in days_agg:
                agg = days_agg[dk]
                agg["in"] += dv.get("in", 0)
                agg["cache"] += dv.get("cache", 0)
                agg["out"] += dv.get("out", 0)
                agg["est_usd"] += d_usd
                agg["sessions"].add(cid)

        usage_by_cid[cid] = {
            "in": ent.get("in", 0),
            "cache": ent.get("cache", 0),
            "out": ent.get("out", 0),
            "est_usd": round(total_usd, 3),
        }
        if cid in active_cids_meta or last_day in days_agg:
            session_rows.append({
                "cid": cid,
                "tid": active_cids_meta.get(cid, {}).get("tid") or ent.get("tid") or cid[:6],
                "live": cid in active_cids_meta,
                "title": ent.get("title") or cid[:8],
                "model": ent.get("model") or "",
                "in": ent.get("in", 0),
                "cache": ent.get("cache", 0),
                "out": ent.get("out", 0),
                "est_usd": round(total_usd, 3),
                "date": last_day or today_key,
                "updated_at": ent.get("updated_at", 0),
            })

    days_7 = []
    total_7d_usd = 0.0
    for dk in day_keys:
        agg = days_agg[dk]
        usd = round(agg["est_usd"], 2)
        total_7d_usd += agg["est_usd"]
        days_7.append({
            "date": dk,
            "in": agg["in"],
            "cache": agg["cache"],
            "out": agg["out"],
            "est_usd": usd,
            "sessions": len(agg["sessions"]),
        })

    session_rows.sort(key=lambda r: (1 if r["live"] else 0, r["date"], r["est_usd"]), reverse=True)
    today_summary = days_7[-1]
    return usage_by_cid, {
        "today": today_summary,
        "days_7": days_7,
        "total_7d_usd": round(total_7d_usd, 2),
        "prices_path": str(PRICES_FILE),
        "top_sessions": session_rows[:12],
    }


def update_quota_history_and_forecast(accounts, now):
    by_key = {}
    total_lines = 0
    pruned = False
    cutoff = now - 7 * 86400
    if QUOTA_HIST_FILE.exists():
        try:
            with QUOTA_HIST_FILE.open("r", encoding="utf-8", errors="ignore") as f:
                for ln in f:
                    total_lines += 1
                    s = ln.strip()
                    if not s:
                        continue
                    try:
                        rec = json.loads(s)
                    except Exception:
                        pruned = True
                        continue
                    ts = rec.get("ts")
                    if not isinstance(ts, (int, float)) or ts < cutoff:
                        pruned = True
                        continue
                    em = rec.get("email")
                    bk = rec.get("bucket")
                    rem = rec.get("rem")
                    if em and bk and isinstance(rem, (int, float)):
                        by_key.setdefault((em, bk), []).append({
                            "ts": int(ts),
                            "email": em,
                            "bucket": bk,
                            "rem": float(rem),
                            "reset_time": rec.get("reset_time"),
                        })
        except OSError:
            pass

    new_entries = []
    now_i = int(now)
    for email, acct in accounts.items():
        quota = acct.get("quota")
        if not isinstance(quota, dict):
            continue
        for bk, bv in quota.items():
            if not isinstance(bv, dict):
                continue
            rem = bv.get("remaining_pct")
            if not isinstance(rem, (int, float)):
                continue
            rem_f = round(float(rem), 1)
            rt = bv.get("reset_time")
            recs = by_key.setdefault((email, bk), [])
            should_append = (
                not recs
                or abs(rem_f - recs[-1]["rem"]) >= 0.1
                or rt != recs[-1].get("reset_time")
                or (now_i - recs[-1]["ts"]) >= 300
            )
            if should_append:
                entry = {"ts": now_i, "email": email, "bucket": bk, "rem": rem_f, "reset_time": rt}
                recs.append(entry)
                new_entries.append(entry)

            if rt:
                cycle = [r for r in recs if r.get("reset_time") == rt]
            else:
                cycle = []
                for r in reversed(recs):
                    if cycle and r["rem"] < cycle[-1]["rem"] - 10.0:
                        break
                    cycle.append(r)
                cycle.reverse()
            if not cycle:
                cycle = [{"ts": now_i, "rem": rem_f}]

            win_sec = 86400 if "weekly" in bk else 5400
            slope_recs = [r for r in cycle if (now_i - r["ts"]) <= win_sec]
            if len(slope_recs) < 2:
                slope_recs = cycle

            burn = None
            if len(slope_recs) >= 2 and (slope_recs[-1]["ts"] - slope_recs[0]["ts"]) >= 60:
                t0 = slope_recs[0]["ts"]
                xs = [r["ts"] - t0 for r in slope_recs]
                ys = [r["rem"] for r in slope_recs]
                n = len(xs)
                mx = sum(xs) / n
                my = sum(ys) / n
                denom = sum((x - mx) ** 2 for x in xs)
                if denom > 0:
                    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom
                    burn = round(max(0.0, -slope * 3600.0), 2)
                else:
                    burn = 0.0

            eta_sec = None
            exhausts = False
            if burn is not None and burn >= 0.05 and rem_f > 0:
                eta_sec = int(round((rem_f / burn) * 3600.0))
                rem_reset = bv.get("reset_in_sec")
                if isinstance(rem_reset, (int, float)) and eta_sec < rem_reset:
                    exhausts = True

            if len(cycle) <= 16:
                spark = [round(r["rem"], 1) for r in cycle]
            else:
                step = (len(cycle) - 1) / 15.0
                spark = [round(cycle[int(round(i * step))]["rem"], 1) for i in range(16)]

            bv["burn_pct_per_h"] = burn
            bv["eta_empty_sec"] = eta_sec
            bv["exhausts_before_reset"] = exhausts
            bv["spark"] = spark

    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        if total_lines > 2500 or pruned:
            all_recs = []
            for recs in by_key.values():
                all_recs.extend(recs)
            all_recs.sort(key=lambda r: r["ts"])
            tmp = QUOTA_HIST_FILE.with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as f:
                for r in all_recs:
                    f.write(json.dumps(r, separators=(",", ":")) + "\n")
            tmp.replace(QUOTA_HIST_FILE)
        elif new_entries:
            with QUOTA_HIST_FILE.open("a", encoding="utf-8") as f:
                for r in new_entries:
                    f.write(json.dumps(r, separators=(",", ":")) + "\n")
    except OSError:
        pass


def extract_ctx_keywords(tr, title):
    raw_chunks = []
    if tr.get("work_dir"):
        raw_chunks.append(tr["work_dir"])
    if tr.get("inferred_cwd"):
        raw_chunks.append(os.path.basename(tr["inferred_cwd"]))
    raw_chunks.extend(tr.get("mcp_queries") or [])
    raw_chunks.extend(tr.get("active_skills") or [])
    for wf in (tr.get("working_files") or [])[:5]:
        raw_chunks.append(wf.get("name") or "")
        raw_chunks.append(wf.get("dir") or "")
    if title:
        raw_chunks.append(title)

    tokens = []
    seen = set()
    for chunk in raw_chunks:
        # Extract alphanumeric / CJK tokens while splitting hyphen/dot compounds cleanly
        parts = re.findall(r"[A-Za-z0-9가-힣_-]{3,28}", str(chunk))
        for p in parts:
            sub = re.findall(r"[A-Za-z0-9가-힣]{3,24}", p.lower())
            for tok in sub:
                if tok in STOPWORDS or tok.isdigit():
                    continue
                if tok not in seen:
                    seen.add(tok)
                    tokens.append(tok)
                    if len(tokens) >= 8:
                        return tokens
    return tokens


def open_memory_db():
    if not MEMORY_DB or not MEMORY_DB.exists():
        return None
    try:
        return sqlite3.connect(f"file:{MEMORY_DB}?mode=ro", uri=True, timeout=0.4)
    except sqlite3.Error:
        return None


def read_memory_db(db, now):
    res = {"available": bool(db), "mode": "sqlite" if db else "docs", "slots": [], "entries": [], "nodes": []}
    if not db:
        return res
    try:
        for row in db.execute(
            "SELECT label, pinned, scope, size_limit, length(COALESCE(content,'')) AS size, updated_at, substr(COALESCE(content,''), 1, 260) FROM slots ORDER BY pinned DESC, label ASC"
        ).fetchall():
            ep = parse_iso_epoch(row[5])
            res["slots"].append({
                "label": row[0],
                "pinned": bool(row[1]),
                "scope": row[2] or "project",
                "limit": row[3] or 2000,
                "size": row[4] or 0,
                "updated_at": row[5],
                "age_sec": max(0, int(now - ep)) if ep else None,
                "preview": (row[6] or "").strip(),
            })

        for row in db.execute(
            "SELECT id, kind, substr(COALESCE(content,''), 1, 145), COALESCE(concepts,''), COALESCE(hit_count,0), last_recalled_at, updated_at "
            "FROM memories WHERE kind IN ('memory','lesson','crystal') AND COALESCE(archived,0)=0 "
            "ORDER BY COALESCE(last_recalled_at, updated_at) DESC LIMIT 8"
        ).fetchall():
            ep = parse_iso_epoch(row[5] or row[6])
            concepts = [c.strip() for c in (row[3] or "").split(",") if c.strip()][:4]
            raw_txt = (row[2] or "").replace("\n", " ").strip()
            if len(raw_txt) >= 140:
                raw_txt = raw_txt[:137].rstrip() + "..."
            res["entries"].append({
                "id": row[0],
                "kind": row[1],
                "preview": raw_txt,
                "concepts": concepts,
                "hits": row[4],
                "age_sec": max(0, int(now - ep)) if ep else None,
            })

        for row in db.execute(
            "SELECT id, kind, label, substr(COALESCE(summary,''), 1, 100), updated_at FROM nodes ORDER BY updated_at DESC LIMIT 6"
        ).fetchall():
            ep = parse_iso_epoch(row[4])
            res["nodes"].append({
                "id": row[0],
                "kind": row[1],
                "label": row[2],
                "summary": (row[3] or "").replace("\n", " ").strip(),
                "age_sec": max(0, int(now - ep)) if ep else None,
            })
    except sqlite3.Error:
        pass
    return res


def load_ctx_cache():
    if not CTX_CACHE_FILE.exists():
        return {}
    try:
        d = json.loads(CTX_CACHE_FILE.read_text())
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def save_ctx_cache(cache):
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        # prune to last 16 entries
        if len(cache) > 16:
            items = sorted(cache.items(), key=lambda kv: kv[1].get("ts", 0), reverse=True)[:16]
            cache = dict(items)
        tmp = CTX_CACHE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(cache))
        tmp.replace(CTX_CACHE_FILE)
    except Exception:
        pass


def load_memory_corpus(db, now):
    """Load compact active memories and ontology nodes once per poll when MODULOR_MEMORY_DB is configured."""
    memories = []
    onto_nodes = []
    if not db:
        return memories, onto_nodes
    try:
        for row in db.execute(
            "SELECT id, kind, substr(COALESCE(content,''), 1, 220), COALESCE(concepts,''), "
            "COALESCE(hit_count,0), last_recalled_at, updated_at "
            "FROM memories WHERE kind IN ('memory','lesson','crystal') AND COALESCE(archived,0)=0 "
            "ORDER BY COALESCE(last_recalled_at, updated_at) DESC"
        ).fetchall():
            ep = parse_iso_epoch(row[5] or row[6])
            raw_txt = (row[2] or "").replace("\n", " ").strip()
            preview = (raw_txt[:137].rstrip() + "...") if len(raw_txt) >= 140 else raw_txt
            concepts = [c.strip() for c in (row[3] or "").split(",") if c.strip()][:4]
            blob = f"{raw_txt} {row[3]}".lower()
            memories.append({
                "id": row[0],
                "kind": row[1],
                "preview": preview,
                "concepts": concepts,
                "hits": row[4],
                "age_sec": max(0, int(now - ep)) if ep else None,
                "blob": blob,
            })
        for row in db.execute(
            "SELECT id, kind, label, substr(COALESCE(summary,''), 1, 140), COALESCE(importance, 0.5) "
            "FROM nodes WHERE kind IN ('concept', 'entity', 'knowledge') "
            "ORDER BY CASE kind WHEN 'concept' THEN 0 WHEN 'entity' THEN 1 ELSE 2 END, "
            "COALESCE(importance, 0.5) DESC, updated_at DESC"
        ).fetchall():
            lbl = row[2] or row[0]
            # Deprioritize external trend/SEO feed snapshots unless matched directly
            is_feed = lbl.startswith("# Trend:") or lbl.startswith("# SEO:")
            onto_nodes.append({
                "id": row[0],
                "kind": row[1],
                "label": lbl,
                "summary": (row[3] or "").replace("\n", " ").strip(),
                "imp": float(row[4] or 0.5),
                "is_feed": is_feed,
                "blob": f"{lbl} {row[3] or ''}".lower(),
            })
    except sqlite3.Error:
        pass
    return memories, onto_nodes


def load_workspace_docs(doc_root, now):
    """Zero-config fallback: extract rules and markdown headings from the active project root."""
    if not doc_root or doc_root == "/" or doc_root == str(HOME.resolve()):
        return []
    root = Path(doc_root)
    if not root.is_dir():
        return []

    cand_names = ("AGENTS.md", "CLAUDE.md", "MEMORY.md", ".cursorrules", "RECIPE.md", "README.md")
    files = []
    for fn in cand_names:
        p = root / fn
        if p.is_file():
            files.append((fn in ("AGENTS.md", "CLAUDE.md", "MEMORY.md", ".cursorrules"), p))
    docs_dir = root / "docs"
    if docs_dir.is_dir():
        try:
            for dp in sorted(docs_dir.glob("*.md"))[:2]:
                if dp.is_file():
                    files.append((False, dp))
        except OSError:
            pass

    items = []
    for is_rule, fp in files[:8]:
        try:
            st = fp.stat()
            age_sec = max(0, int(now - st.st_mtime))
            raw = fp.read_bytes()[:12288].decode("utf-8", "ignore")
        except OSError:
            continue
        kind = "rule" if is_rule else "doc"
        rel_name = fp.name if fp.parent == root else f"docs/{fp.name}"
        heading = rel_name
        body_lines = []

        def flush_sec():
            nonlocal heading, body_lines
            snippet = " ".join(body_lines).strip()
            if snippet:
                preview = f"{rel_name} · {heading}: {snippet}" if heading != rel_name else f"{rel_name}: {snippet}"
                if len(preview) >= 140:
                    preview = preview[:137].rstrip() + "..."
                items.append({
                    "id": f"doc:{rel_name}:{heading[:24]}",
                    "kind": kind,
                    "concepts": [heading[:18], rel_name],
                    "preview": preview,
                    "hits": 0,
                    "age_sec": age_sec,
                    "blob": f"{rel_name} {heading} {snippet}".lower(),
                    "is_rule": is_rule,
                })
            body_lines = []

        for ln in raw.splitlines():
            s = ln.strip()
            if not s or s.startswith(("```", "![", "---", "|")):
                continue
            if s.startswith("#"):
                flush_sec()
                heading = s.lstrip("#").strip()[:48] or rel_name
            else:
                clean_s = re.sub(r"[`*_]", "", s).lstrip("-• ").strip()
                if clean_s and len(body_lines) < 3:
                    body_lines.append(clean_s)
        flush_sec()
    return items


def query_workspace_docs(doc_root, keywords, now, ctx_cache):
    sig = f"docs:{doc_root}:{','.join(keywords[:6])}"
    cached = ctx_cache.get(sig)
    if cached and (now - cached.get("ts", 0)) < 45:
        return cached.get("entries", []), [], [], False

    docs = load_workspace_docs(doc_root, now)
    entries = []
    if docs:
        scored = []
        for idx, d in enumerate(docs):
            matched = [k for k in keywords if k in d["blob"]]
            base_w = 2.0 if d["is_rule"] else 1.0
            score = len(matched) * 3.5 + base_w - (idx * 0.01)
            scored.append((score, matched[:3], d))
        scored.sort(key=lambda x: x[0], reverse=True)
        for _, matched, d in scored[:5]:
            entries.append({
                "id": d["id"],
                "kind": d["kind"],
                "preview": d["preview"],
                "concepts": d["concepts"],
                "hits": 0,
                "matched": matched or [d["kind"]],
                "age_sec": d["age_sec"],
            })

    ctx_cache[sig] = {"ts": now, "entries": entries, "db_nodes": [], "db_edges": []}
    return entries, [], [], True


def query_db_context(db, corpus, doc_root, keywords, now, ctx_cache):
    if not db:
        return query_workspace_docs(doc_root, keywords, now, ctx_cache)

    sig = ",".join(keywords[:8])
    cached = ctx_cache.get(sig)
    if cached and (now - cached.get("ts", 0)) < 45:
        return cached.get("entries", []), cached.get("db_nodes", []), cached.get("db_edges", []), False

    memories, onto_nodes = corpus
    entries = []
    db_nodes = []
    db_edges = []

    if keywords:
        # 1. Rank active memories (~621 items -> ~1ms in Python)
        scored_mem = []
        for idx, m in enumerate(memories):
            hits = [k for k in keywords if k in m["blob"]]
            if not hits:
                continue
            kind_w = 2.0 if m["kind"] == "lesson" else (1.5 if m["kind"] == "crystal" else 1.0)
            score = len(hits) * 3.0 + kind_w + min(1.5, (m["hits"] or 0) * 0.1) - (idx * 0.001)
            scored_mem.append((score, hits[:3], m))
        scored_mem.sort(key=lambda x: x[0], reverse=True)
        for _, matched, m in scored_mem[:6]:
            entries.append({
                "id": m["id"],
                "kind": m["kind"],
                "preview": m["preview"],
                "concepts": m["concepts"],
                "hits": m["hits"],
                "matched": matched,
                "age_sec": m["age_sec"],
            })

        # 2. Rank ontology nodes + indexed edge lookup (0.1ms)
        scored_nodes = []
        for n in onto_nodes:
            nhits = [k for k in keywords if k in n["blob"]]
            if not nhits:
                continue
            if n["is_feed"] and len(nhits) < 2:
                continue
            kw_bonus = 2.5 if n["kind"] in ("concept", "entity") else 1.0
            nscore = len(nhits) * 3.0 + kw_bonus + n["imp"]
            scored_nodes.append((nscore, n))
        scored_nodes.sort(key=lambda x: x[0], reverse=True)
        node_map = {}
        seed_ids = []
        for _, n in scored_nodes[:4]:
            nid = n["id"]
            seed_ids.append(nid)
            node_map[nid] = {"id": nid, "kind": n["kind"], "label": n["label"], "summary": n["summary"]}

        if db and seed_ids:
            try:
                raw_edges = []
                for sid in seed_ids[:4]:
                    raw_edges.extend(
                        db.execute(
                            "SELECT src, dst, rel FROM edges WHERE src = ? UNION ALL SELECT src, dst, rel FROM edges WHERE dst = ? LIMIT 6",
                            (sid, sid),
                        ).fetchall()
                    )
                extra_ids = []
                seen_e = set()
                for src, dst, rel in raw_edges:
                    ek = (src, dst, rel)
                    if ek in seen_e:
                        continue
                    seen_e.add(ek)
                    db_edges.append({"src": src, "dst": dst, "rel": rel or "rel"})
                    if src not in node_map and src not in extra_ids:
                        extra_ids.append(src)
                    if dst not in node_map and dst not in extra_ids:
                        extra_ids.append(dst)
                extra_ids = extra_ids[:3]
                if extra_ids:
                    eph = ",".join("?" for _ in extra_ids)
                    for nid, nkind, nlabel, nsum in db.execute(
                        f"SELECT id, kind, label, substr(COALESCE(summary,''), 1, 90) FROM nodes WHERE id IN ({eph})",
                        extra_ids,
                    ).fetchall():
                        node_map[nid] = {"id": nid, "kind": nkind or "node", "label": nlabel or nid, "summary": (nsum or "").replace("\n", " ").strip()}
                db_nodes = list(node_map.values())[:6]
                kept_ids = {n["id"] for n in db_nodes}
                db_edges = [e for e in db_edges if e["src"] in kept_ids and e["dst"] in kept_ids][:8]
            except sqlite3.Error:
                pass

    ctx_cache[sig] = {"ts": now, "entries": entries, "db_nodes": db_nodes, "db_edges": db_edges}
    return entries, db_nodes, db_edges, True


def build_ctx_graph(tid, title, tr, db_entries, db_nodes, db_edges):
    root_label = tr.get("work_dir") or (title[:18] if title else tid)
    nodes = [{"id": "focus", "kind": "focus", "label": root_label[:18], "tier": 0}]
    edges = []
    node_ids = {"focus"}

    # Tier 1: top hot working files / active skills / live MCP
    tier1 = []
    for wf in (tr.get("working_files") or [])[:3]:
        nid = f"f:{wf['name']}"
        if nid not in node_ids:
            node_ids.add(nid)
            tier1.append({"id": nid, "kind": "edit" if wf["writes"] > 0 else "file", "label": wf["name"][:16], "tier": 1})
            edges.append({"src": "focus", "dst": nid, "rel": "EDIT" if wf["writes"] > 0 else "READ", "active": wf["age_sec"] < 120})
    if len(tier1) < 3:
        for sk in (tr.get("active_skills") or [])[:2]:
            nid = f"s:{sk}"
            if nid not in node_ids and len(tier1) < 3:
                node_ids.add(nid)
                tier1.append({"id": nid, "kind": "skill", "label": sk[:16], "tier": 1})
                edges.append({"src": "focus", "dst": nid, "rel": "SKILL", "active": True})
    nodes.extend(tier1)

    # Tier 2 / 3: optional SQLite ontology nodes + connected edges (or doc/memory concepts fallback)
    seed_targets = []
    if db_nodes:
        out_deg = {n["id"]: 0 for n in db_nodes}
        for e in db_edges:
            if e["dst"] in out_deg:
                out_deg[e["dst"]] += 1
        # Nodes not targeted only as dst sit in Tier 2, linked targets sit in Tier 3
        for dn in db_nodes[:4]:
            did = f"n:{dn['id']}"
            if did in node_ids:
                continue
            tier = 3 if (out_deg.get(dn["id"], 0) > 0 and len(db_nodes) > 2) else 2
            node_ids.add(did)
            nodes.append({"id": did, "kind": dn["kind"], "label": str(dn["label"])[:16], "tier": tier})
            if tier == 2:
                seed_targets.append(did)
        for e in db_edges[:6]:
            s_id = f"n:{e['src']}"
            d_id = f"n:{e['dst']}"
            if s_id in node_ids and d_id in node_ids:
                edges.append({"src": s_id, "dst": d_id, "rel": str(e["rel"])[:10], "active": False})
    else:
        used_labels = {n["label"].lower() for n in nodes}
        for me in db_entries[:5]:
            if len(seed_targets) >= 3:
                break
            mid = f"m:{me['id']}"
            if mid in node_ids:
                continue
            lbl = ""
            for c in (me.get("concepts") or []):
                cand = str(c).strip()
                if cand and cand[:16].lower() not in used_labels:
                    lbl = cand
                    break
            if not lbl:
                for m_kw in (me.get("matched") or []):
                    cand = str(m_kw).strip()
                    if cand and cand[:16].lower() not in used_labels:
                        lbl = cand
                        break
            if not lbl:
                # Extract a meaningful concise phrase from preview when concepts collide
                prev_clean = re.sub(r"^\[[^\]]+\]\s*", "", str(me.get("preview") or "")).strip()
                lbl = prev_clean[:16]
            if lbl[:16].lower() in used_labels:
                lbl = f"{lbl[:12]} #{str(me['id'])[-3:]}"
            node_ids.add(mid)
            used_labels.add(lbl[:16].lower())
            nodes.append({"id": mid, "kind": me["kind"], "label": lbl[:16], "tier": 2})
            seed_targets.append(mid)

    # Connect Tier 1 nodes (or Focus) -> Tier 2 knowledge/memory seeds so the graph is a connected whole
    tier1_ids = [n["id"] for n in tier1]
    for idx, t2_id in enumerate(seed_targets[:3]):
        src_id = tier1_ids[idx % len(tier1_ids)] if tier1_ids else "focus"
        edges.append({"src": src_id, "dst": t2_id, "rel": "CTX", "active": False})

    # If still only focus + tier1 and db_entries exists, connect up to 2 matched memories
    if not db_nodes and not seed_targets and db_entries:
        for me in db_entries[:2]:
            mid = f"m:{me['id']}"
            node_ids.add(mid)
            nodes.append({"id": mid, "kind": me["kind"], "label": me["preview"][:16], "tier": 2})
            src_id = tier1_ids[0] if tier1_ids else "focus"
            edges.append({"src": src_id, "dst": mid, "rel": "MEM", "active": False})

    return {"nodes": nodes[:8], "edges": edges[:10]}


def main():
    now = time.time()
    pids = find_agy_pids()
    pid_tids, pid_locks, pid_logs = collect_pid_env_and_files(pids)
    cids = set(pid_locks.values())
    sums = summaries_for(cids)
    db = open_memory_db()
    corpus = load_memory_corpus(db, now)
    ctx_cache = load_ctx_cache()
    cache_dirty = False
    global_doc_entries = []
    seen_doc_ids = set()

    terminals = {}
    active_emails = []
    active_methods = {}
    all_activations = []

    for pid in pids:
        tid = pid_tids.get(pid)
        if not tid:
            continue
        cid = pid_locks.get(pid)
        cached = read_terminal_cache(tid)
        if cid is None and not cached:
            continue
        email, auth_method = email_from_logs(pid_logs.get(pid, []))
        if cached.get("email") and not email:
            email = str(cached["email"]).strip().lower()
        if email:
            active_emails.append(email)
            if auth_method and email not in active_methods:
                active_methods[email] = auth_method

        tr = parse_transcript_tail(cid, tid, now) if cid else {}
        all_activations.extend(tr.get("activations") or [])

        # Prefer statusLine cache when it belongs to the same active conversation
        same_conv = bool(cached and cid and cached.get("conversation_id") == cid)
        model = (cached.get("model") if same_conv else None) or tr.get("model")
        ctx_tokens = tr.get("ctx_tokens")
        ctx_pct = cached.get("context_pct") if same_conv else None
        if ctx_pct is None and isinstance(ctx_tokens, int) and ctx_tokens > 0:
            ctx_pct = round(min(100.0, (ctx_tokens / 1048576.0) * 100.0), 1)
        out_tokens = (cached.get("out_tokens") if same_conv and cached.get("out_tokens") is not None else None)
        if out_tokens is None:
            out_tokens = tr.get("out_tokens") or 0

        s_info = sums.get(cid, {}) if cid else {}
        title = (cached.get("title") if same_conv else None) or s_info.get("title") or ""

        keywords = extract_ctx_keywords(tr, title) if cid else []
        ctx_entries, db_nodes, db_edges, dirty = query_db_context(db, corpus, tr.get("inferred_cwd"), keywords, now, ctx_cache) if cid else ([], [], [], False)
        if not db:
            for de in ctx_entries:
                if de["id"] not in seen_doc_ids:
                    seen_doc_ids.add(de["id"])
                    global_doc_entries.append(de)
        if dirty:
            cache_dirty = True
        ctx_graph = build_ctx_graph(tid, title, tr, ctx_entries, db_nodes, db_edges) if cid else {"nodes": [], "edges": []}

        terminals[tid] = {
            "terminal": tid,
            "pid": int(pid) if pid.isdigit() else pid,
            "cid": cid,
            "email": email,
            "plan": cached.get("plan") if same_conv else None,
            "model": model,
            "effort": cached.get("effort") if same_conv else None,
            "title": title,
            "steps": s_info.get("steps", 0),
            "ctx_tokens": ctx_tokens,
            "ctx_pct": ctx_pct,
            "in_tokens": tr.get("in_tokens", 0),
            "cache_tokens": tr.get("cache_tokens", 0),
            "out_tokens": out_tokens,
            "cost_usd": cached.get("cost_usd") if same_conv else None,
            "last_step_at": tr.get("last_step_at"),
            "agent_busy": bool(tr.get("agent_busy")),
            "inferred_cwd": tr.get("inferred_cwd"),
            "work_dir": tr.get("work_dir"),
            "live_calls": tr.get("live_calls") or [],
            "working_files": tr.get("working_files") or [],
            "active_skills": tr.get("active_skills") or [],
            "artifacts": tr.get("artifacts") or [],
            "artifact_items": tr.get("artifact_items") or [],
            "mcp_activations": tr.get("activations") or [],
            "ctx_keywords": keywords,
            "ctx_memories": ctx_entries,
            "ctx_graph": ctx_graph,
            "subagents": tr.get("subagents") or [],
        }

    active_cids_meta = {}
    for tid, tinfo in terminals.items():
        if tinfo.get("cid"):
            active_cids_meta[tinfo["cid"]] = {"tid": tid, "title": tinfo.get("title") or "", "model": tinfo.get("model") or ""}

    prices = load_prices()
    usage_by_cid, usage_summary = update_usage_ledger(active_cids_meta, sums, prices, now)
    for tinfo in terminals.values():
        if tinfo.get("cid") and tinfo["cid"] in usage_by_cid:
            tinfo["usage_total"] = usage_by_cid[tinfo["cid"]]

    conflicts = detect_write_conflicts(terminals, now)

    if cache_dirty:
        save_ctx_cache(ctx_cache)
    all_activations.sort(key=lambda x: x.get("age_sec", 999999))
    accounts, latest_email = normalize_accounts(active_emails, active_methods, now)
    update_quota_history_and_forecast(accounts, now)
    memory = read_memory_db(db, now)
    if not db and global_doc_entries:
        memory["entries"] = global_doc_entries[:8]
        memory["nodes"] = [
            {"id": d["id"], "kind": d["kind"], "label": (d.get("concepts") or [d["id"]])[0], "summary": d["preview"], "age_sec": d.get("age_sec")}
            for d in global_doc_entries[:6]
        ]
    if db:
        try:
            db.close()
        except Exception:
            pass
    memory["activations"] = all_activations[:24]

    payload = {
        "ts": int(now),
        "latest_email": latest_email,
        "active_emails": sorted(set(active_emails)),
        "accounts": accounts,
        "terminals": terminals,
        "conflicts": conflicts,
        "memory": memory,
        "usage": usage_summary,
    }
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
