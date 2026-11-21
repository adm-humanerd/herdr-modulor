#!/bin/sh
exec python3 -c '
import json, os, sys, time
from pathlib import Path

try:
    raw = sys.stdin.read()
    if not raw.strip():
        raise SystemExit(0)
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)

base = Path.home() / ".cache" / "herdr-modulor"
term_dir = base / "terminals"
term_dir.mkdir(parents=True, exist_ok=True)
now = int(time.time())

email = (data.get("email") or "").strip().lower()
plan = data.get("plan_tier")
q = data.get("quota")

def merge_quota(old_q, new_q):
    merged = dict(old_q or {})
    for k, v in (new_q or {}).items():
        if not isinstance(v, dict):
            continue
        prev = merged.get(k)
        if not isinstance(prev, dict):
            merged[k] = v
            continue
        rt_new = v.get("reset_time") or ""
        rt_old = prev.get("reset_time") or ""
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

if email and (isinstance(q, dict) or plan):
    af = base / "accounts.json"
    store = {"latest_email": email, "accounts": {}}
    if af.exists():
        try:
            loaded = json.loads(af.read_text())
            if isinstance(loaded, dict) and isinstance(loaded.get("accounts"), dict):
                store["accounts"] = loaded["accounts"]
        except Exception:
            pass
    prev_acct = store["accounts"].get(email) if isinstance(store["accounts"].get(email), dict) else {}
    old_q = prev_acct.get("quota") if isinstance(prev_acct.get("quota"), dict) else {}
    merged_q = merge_quota(old_q, q) if isinstance(q, dict) and q else old_q
    store["latest_email"] = email
    store["accounts"][email] = {
        "email": email,
        "plan": plan or prev_acct.get("plan"),
        "at": now,
        "quota": merged_q,
    }
    tmp = af.with_suffix(".tmp")
    tmp.write_text(json.dumps(store))
    os.chmod(tmp, 0o600)
    os.replace(tmp, af)

tid = os.environ.get("HC_TERMINAL_ID")
if tid:
    cw = data.get("context_window") or {}
    cu = cw.get("current_usage") or {}
    mdl = data.get("model") or {}
    cost = data.get("cost") or {}
    tf = term_dir / f"{tid}.json"
    prev = {}
    if tf.exists():
        try:
            prev = json.loads(tf.read_text())
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
    tmp = tf.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload))
    os.chmod(tmp, 0o600)
    os.replace(tmp, tf)
' >/dev/null 2>&1
