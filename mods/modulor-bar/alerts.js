const BUCKET_LABELS = {
  "gemini-5h": "GEMINI 5H",
  "gemini-weekly": "GEMINI WK",
  "3p-5h": "CLAUDE/GPT 5H",
  "3p-weekly": "CLAUDE/GPT WK",
};

function labelForBucket(bk) {
  return BUCKET_LABELS[bk] ?? String(bk).toUpperCase();
}

function fmtLeftShort(sec) {
  if (typeof sec !== "number" || Number.isNaN(sec)) return "--";
  if (sec <= 0) return "now";
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

function quotaLevel(rem) {
  if (typeof rem !== "number" || Number.isNaN(rem)) return "ok";
  if (rem <= 15) return "crit";
  if (rem <= 35) return "warn";
  return "ok";
}

function ctxLevel(pct) {
  if (typeof pct !== "number" || Number.isNaN(pct)) return "ok";
  if (pct >= 90) return "crit";
  if (pct >= 80) return "warn";
  return "ok";
}

const RANK = { ok: 0, warn: 1, crit: 2 };

export function evaluateAlerts(store, prevState, nowMs = Date.now()) {
  const s = store ?? {};
  const prev = prevState && typeof prevState === "object" ? prevState : {};
  const initialized = Boolean(prev._initialized);
  const prevBuckets = prev.buckets ?? {};
  const prevCtx = prev.ctx ?? {};
  const prevStale = prev.probeStale ?? {};

  const nextBuckets = { ...prevBuckets };
  const nextCtx = { ...prevCtx };
  const nextStale = { ...prevStale };
  const fired = [];
  const nowSec = Math.floor(nowMs / 1000);

  for (const [mk, tel] of Object.entries(s)) {
    if (!tel || typeof tel !== "object") continue;

    // 1. Quota threshold & refill checks
    for (const [email, acct] of Object.entries(tel.accounts ?? {})) {
      for (const [bk, bv] of Object.entries(acct?.quota ?? {})) {
        const rem = bv?.remaining_pct;
        if (typeof rem !== "number" || Number.isNaN(rem)) continue;
        const key = `${mk}:${email}:${bk}`;
        const old = prevBuckets[key];
        const curLvl = quotaLevel(rem);
        const rt = bv.reset_time ?? null;

        if (old) {
          if (RANK[curLvl] > RANK[old.level ?? "ok"]) {
            const isCrit = curLvl === "crit";
            fired.push({
              title: isCrit ? `Quota Critical ≤15% · ${labelForBucket(bk)}` : `Quota Low ≤35% · ${labelForBucket(bk)}`,
              body: `${email}: ${Math.round(rem)}% left (reset ${fmtLeftShort(bv.reset_in_sec)})`,
              level: isCrit ? "error" : "warning",
              sound: isCrit ? "blocked" : null,
              action: { name: "modulor-bar.quota" },
            });
          } else if (old.reset_time && rt && old.reset_time !== rt && rem > (old.rem ?? 100) + 5 && (old.rem ?? 100) <= 50) {
            fired.push({
              title: `Quota Refilled · ${labelForBucket(bk)}`,
              body: `${email}: restored to ${Math.round(rem)}%`,
              level: "success",
              sound: null,
              action: { name: "modulor-bar.quota" },
            });
          }
        } else if (initialized && curLvl === "crit") {
          fired.push({
            title: `Quota Critical ≤15% · ${labelForBucket(bk)}`,
            body: `${email}: ${Math.round(rem)}% left (reset ${fmtLeftShort(bv.reset_in_sec)})`,
            level: "error",
            sound: "blocked",
            action: { name: "modulor-bar.quota" },
          });
        }

        nextBuckets[key] = { level: curLvl, reset_time: rt, rem };
      }
    }

    // 2. Context window threshold checks
    for (const [tid, info] of Object.entries(tel.terminals ?? {})) {
      const pct = info?.ctx_pct;
      if (typeof pct !== "number" || Number.isNaN(pct)) continue;
      const key = `${mk}:${tid}`;
      const oldLvl = prevCtx[key] ?? "ok";
      const curLvl = ctxLevel(pct);
      const hadPrev = key in prevCtx;

      if ((hadPrev || initialized) && RANK[curLvl] > RANK[oldLvl]) {
        const isCrit = curLvl === "crit";
        const addr = mk === "__local__" ? tid : `${mk}/${tid}`;
        const label = info.title || info.work_dir || info.model || tid;
        fired.push({
          title: `Context ${Math.round(pct)}% · ${tid}`,
          body: `${label} — consider /compact`,
          level: isCrit ? "error" : "warning",
          sound: isCrit ? "blocked" : null,
          action: { name: "agent.focus", args: { terminal: addr } },
        });
      }
      nextCtx[key] = curLvl;
    }

    // 3. Probe stale check (local only so unreachable remote SSH doesn't spam)
    if (mk === "__local__" && typeof tel.ts === "number") {
      const stale = nowSec - tel.ts > 60;
      if (stale && !prevStale[mk]) {
        fired.push({
          title: "Modulor Probe Stale",
          body: `Local telemetry unchanged for ${nowSec - tel.ts}s`,
          level: "error",
          sound: null,
        });
      }
      nextStale[mk] = stale;
    }
  }

  return {
    fired,
    next: {
      _initialized: true,
      buckets: nextBuckets,
      ctx: nextCtx,
      probeStale: nextStale,
    },
  };
}
