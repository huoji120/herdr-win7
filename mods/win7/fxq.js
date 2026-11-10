// 飞行棋 (the separate mod `fxq`, github.com/heromantf/herdr-fxq) on the
// Win7 desktop: a desktop icon, a Start menu entry and a taskbar button. The
// game draws its own window (`mod.open fxq` opens it, again hides it); this
// only follows its table, from the state file its client writes
// (data/fxq/state.json), into shared FXQ for the taskbar:
//   { installed, inRoom, yours, text }
// The mod's own shared "fxq.open" says whether its window is open.

import * as fs from "fs/promises";
import { shared, setShared, hc, appHome, readTextFile, watchFolder, run } from "herdr";

export const FXQ = "win7.fxq";
export const FXQ_ICON = "mods/fxq/icons/fxq.svg";
export const fxqOpen = () => Boolean(shared("fxq.open"));

/** Opens the 飞行棋 window, or leaves it be when it's already open (mod.open again would hide it). */
export function openFxq() {
  if (!fxqOpen()) run("mod.open", { name: "fxq" });
}

export function toggleFxq() {
  run("mod.open", { name: "fxq" });
}

async function alive(name) {
  try {
    const r = await hc(["get", name, "--json"]);
    return r.code === 0 && JSON.parse(r.stdout)?.state === "live";
  } catch {
    return false;
  }
}

function summary(v) {
  const s = v?.status === "online" ? v.state : null;
  if (!s) return { inRoom: false, yours: false, text: v?.status === "connecting" ? "连接中" : null };
  const home = s.planes?.[s.you]?.filter((p) => p === 56).length ?? 0;
  const playing = s.phase === "roll" || s.phase === "move";
  const yours = Boolean(playing && s.turn === s.you && !s.seats?.[s.you]?.auto && !v.ai);
  const text = yours ? (s.phase === "roll" ? "轮到你掷骰子" : "轮到你走棋")
    : v.ai && playing ? `AI 代下中 · ${home}/4`
    : s.phase === "lobby" ? `房间 ${s.seats.filter(Boolean).length}/4`
    : s.phase === "over" ? (s.result?.winner === s.you ? "你赢了" : "本局结束")
    : `对局中 · ${home}/4`;
  return { inRoom: true, yours, text };
}

/** Taskbar init: whether 飞行棋 is installed, then its table as it changes. */
export function watchFxq(cx) {
  cx.spawn(async () => {
    const home = appHome();
    let installed = false;
    try { installed = Boolean(await readTextFile(`${home}/mods/fxq/mod.json`)); } catch {}
    const put = (x) => {
      const next = { installed, ...x };
      if (JSON.stringify(next) !== JSON.stringify(shared(FXQ))) setShared(FXQ, next);
    };
    put({ inRoom: false, yours: false, text: null });
    if (!installed) return;
    const dir = `${home}/data/fxq`;
    try { await fs.mkdir(dir, { recursive: true }); } catch {}
    // A state file left from before (no client running) says nothing about now.
    let seq = null;
    const load = async () => {
      try {
        const v = JSON.parse((await readTextFile(`${dir}/state.json`)) ?? "null");
        if (!v || v.seq === seq) return;
        seq = v.seq;
        put(summary(v));
      } catch {}
    };
    if (await alive("fxq-client")) await load();
    else {
      try { seq = JSON.parse((await readTextFile(`${dir}/state.json`)) ?? "null")?.seq ?? null; } catch {}
    }
    for (;;) {
      try { await watchFolder(dir); } catch { return; }
      await load();
    }
  });
}
