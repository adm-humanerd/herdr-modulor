#!/bin/sh
trap 'exit 0' HUP INT TERM PIPE
command -v python3 >/dev/null 2>&1 || exit 0

SCRIPT='
import fcntl, json, os, sys, time
from contextlib import contextmanager
from pathlib import Path

STRICT = os.environ.get("AGY_STATUSLINE_STRICT") == "1"

def as_dict(val):
    return val if isinstance(val, dict) else {}

@contextmanager
def file_lock(lock_path):
    fd = None
    try:
        fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o600)
        for _ in range(30):
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                time.sleep(0.01)
        yield
    finally:
        if fd is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            except OSError:
                pass
            try:
                os.close(fd)
            except OSError:
                pass

def atomic_write_json(target, obj, mode=0o600):
    tmp = target.parent / f".{target.name}.{os.getpid()}.{time.time_ns()}.tmp"
    try:
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f)
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass

def merge_quota(old_q, new_q):
    merged = dict(old_q or {})
    for k, v in (new_q or {}).items():
        if not isinstance(v, dict):
            continue
        prev = merged.get(k)
        if not isinstance(prev, dict):
            merged[k] = v
            continue
        rt_new = str(v.get("reset_time") or "")
        rt_old = str(prev.get("reset_time") or "")
        if rt_new > rt_old:
            merged[k] = v
        elif rt_new < rt_old:
            merged[k] = prev
        else:
            rf_new = v.get("remaining_fraction")
            rf_old = prev.get("remaining_fraction")
            if isinstance(rf_old, (int, float)) and isinstance(rf_new, (int, float)):
                merged[k] = prev if rf_old < rf_new else v
            else:
                merged[k] = v
    return merged

def run():
    raw = sys.stdin.read()
    if not raw.strip():
        return
    try:
        data = json.loads(raw)
    except Exception:
        return
    if not isinstance(data, dict):
        return

    base = Path.home() / ".cache" / "herdr-modulor"
    term_dir = base / "terminals"
    term_dir.mkdir(parents=True, exist_ok=True)
    now = int(time.time())

    raw_email = data.get("email")
    email = raw_email.strip().lower() if isinstance(raw_email, str) else ""
    plan = data.get("plan_tier")
    q = data.get("quota")

    if email and (isinstance(q, dict) or plan):
        af = base / "accounts.json"
        with file_lock(base / ".accounts.lock"):
            store = {"latest_email": email, "accounts": {}}
            if af.exists():
                try:
                    loaded = json.loads(af.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict) and isinstance(loaded.get("accounts"), dict):
                        store["accounts"] = loaded["accounts"]
                except Exception:
                    pass
            prev_acct = as_dict(store["accounts"].get(email))
            old_q = as_dict(prev_acct.get("quota"))
            merged_q = merge_quota(old_q, q) if isinstance(q, dict) and q else old_q
            store["latest_email"] = email
            store["accounts"][email] = {
                "email": email,
                "plan": plan or prev_acct.get("plan"),
                "at": now,
                "quota": merged_q,
            }
            atomic_write_json(af, store, 0o600)

    raw_tid = os.environ.get("HC_TERMINAL_ID") or ""
    tid = os.path.basename(raw_tid.strip())
    if tid and tid not in (".", ".."):
        cw = as_dict(data.get("context_window"))
        cu = as_dict(cw.get("current_usage"))
        mdl = as_dict(data.get("model"))
        cost = as_dict(data.get("cost"))
        tf = term_dir / f"{tid}.json"
        with file_lock(term_dir / f".{tid}.lock"):
            prev = {}
            if tf.exists():
                try:
                    loaded_tf = json.loads(tf.read_text(encoding="utf-8"))
                    if isinstance(loaded_tf, dict):
                        prev = loaded_tf
                except Exception:
                    prev = {}
            payload = {
                "at": now,
                "email": email or prev.get("email"),
                "plan": plan or prev.get("plan"),
                "conversation_id": data.get("conversation_id") or prev.get("conversation_id"),
                "title": data.get("conversation_title") or prev.get("title"),
                "model": mdl.get("display_name") or mdl.get("id") or prev.get("model"),
                "model_id": mdl.get("id") or prev.get("model_id"),
                "effort": mdl.get("effort") or prev.get("effort"),
                "context_pct": cw.get("used_percentage") if cw.get("used_percentage") is not None else prev.get("context_pct"),
                "context_size": cw.get("context_window_size") or prev.get("context_size"),
                "in_tokens": cu.get("input_tokens") if cu.get("input_tokens") is not None else cw.get("total_input_tokens"),
                "cache_tokens": cu.get("cache_read_input_tokens"),
                "out_tokens": cw.get("total_output_tokens"),
                "cost_usd": cost.get("total_usd"),
                "agent_state": data.get("agent_state"),
            }
            atomic_write_json(tf, payload, 0o600)

try:
    run()
except Exception:
    if STRICT:
        raise
'

if [ "${AGY_STATUSLINE_STRICT:-}" = "1" ]; then
  exec python3 -c "$SCRIPT"
fi

python3 -c "$SCRIPT" >/dev/null 2>&1 || exit 0
