#!/usr/bin/env node
// 斗地主 for an AI, as an MCP server (stdio): the AI plays *your* seat, the
// one in your Herdr 7 window, and you watch it there. It talks to your game
// window's client (client.mjs, the terminal ddz-client) over its local
// control port, found in the client's state file. Add it to an agent, e.g.
// Claude Code:
//
//   claude mcp add ddz -- node <this file>
//
// Options: --state <file> (default <Herdr home>/data/ddz/state.json, the
// Herdr home being $HERDR_APP_HOME or ~/.config/herdr-app). If the client
// isn't running it is started (needs hc). No dependencies.

import net from "node:net";
import os from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import readline from "node:readline";
import { analyze, options, isWild, rank, rankLabel, SUITS, NAMES, BOMB_NAMES } from "./rules.js";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const HOME = process.env.HERDR_APP_HOME || join(os.homedir(), ".config", "herdr-app");
const STATE = arg("state", join(HOME, "data", "ddz", "state.json"));
const HERE = dirname(fileURLToPath(import.meta.url));

let link = null, view = null, linking = null;
const listeners = new Set();
const changed = () => { for (const f of [...listeners]) f(); };

function until(test, ms) {
  return new Promise((resolve) => {
    if (test()) return resolve(true);
    const done = (v) => { listeners.delete(check); clearTimeout(t); resolve(v); };
    const check = () => { if (test()) done(true); };
    const t = setTimeout(() => done(false), ms);
    listeners.add(check);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readState = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } };

/** Your game window's client: started if it isn't running, then its control port. */
async function connect() {
  if (link) return;
  if (linking) return linking;
  linking = (async () => {
    let st = readState();
    for (let k = 0; k < 2 && !link; k++) {
      if (st?.control) {
        try {
          await new Promise((resolve, reject) => {
            const c = net.connect(st.control.port, "127.0.0.1", () => resolve());
            c.once("error", reject);
            c.setEncoding("utf8");
            let buf = "";
            c.on("data", (chunk) => {
              buf += chunk;
              let nl;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                try { const m = JSON.parse(line); if (m.t === "view") { view = m.view; changed(); } } catch {}
              }
            });
            c.on("close", () => { if (link === c) link = null; changed(); });
            c.write(JSON.stringify({ t: "_auth", token: st.control.token }) + "\n");
            link = c;
          });
          await until(() => view, 3000);
          break;
        } catch { link = null; }
      }
      if (k === 0) {
        // Not running (or gone): start it as the game window would.
        const name = os.userInfo().username;
        spawnSync("hc", ["run", "--bg", "--no-parent", "--name", "ddz-client", "--", "node", join(HERE, "client.mjs"), STATE, name], { stdio: "ignore", shell: process.platform === "win32" });
        for (let w = 0; w < 30 && !(readState()?.control); w++) await sleep(200);
        st = readState();
      }
    }
    if (!link) throw new Error("连不上你的斗地主客户端：先在 Herdr 7 里打开斗地主（桌面图标或开始菜单）");
  })().finally(() => { linking = null; });
  return linking;
}

function send(m) {
  link.write(JSON.stringify(m) + "\n");
}

// ---- what the agent reads

const cardName = (id, wild) => {
  if (id === 52) return "小王";
  if (id === 53) return "大王";
  return `${SUITS[id % 4]}${rankLabel(rank(id))}${isWild(id, wild) ? "(赖)" : ""}`;
};
const comboName = (c) => (!c ? "" : c.type === "bomb" ? BOMB_NAMES[c.kind] : NAMES[c.type]);
const DOUBLES = { 1: "不加倍", 2: "加倍", 4: "超级加倍" };

function summary() {
  const v = view ?? {};
  const s = v.state;
  const base = { connection: v.status ?? "idle", room: v.addr ?? null, error: v.error ?? undefined };
  if (v.status !== "online" || !s) return { ...base, hint: "还没进房间：用 ddz_rooms 找房间，ddz_join 加入（需要房间密码），或者让主人在 Herdr 里开房/加入。" };
  const roleOf = (i) => (s.landlord < 0 ? null : s.landlord === i ? "地主" : "农民");
  const against = s.lead ? null : s.last?.combo ?? null;
  const yourTurn = s.turn === s.you && ["bid", "double", "play"].includes(s.phase);
  const out = {
    ...base,
    phase: { lobby: "等待开始", bid: "叫分", double: "加倍", play: "出牌", over: "本局结束" }[s.phase] ?? s.phase,
    you: s.you,
    you_are_host: s.host,
    your_role: roleOf(s.you),
    your_turn: yourTurn,
    seconds_left: yourTurn && s.deadline != null ? Math.round(s.deadline / 1000) : null,
    wild: s.wild != null ? `${rankLabel(s.wild)}（赖子，可当 3～2 任意点数，不能当王）` : null,
    hand: s.hand.map((id) => ({ id, card: cardName(id, s.wild) })),
    players: s.seats.map((p, i) => p && { seat: i, name: p.name, role: roleOf(i), cards: p.cards, tokens: p.tokens, double: DOUBLES[s.doubles?.[i] ?? 1], bot: p.bot }),
    table: s.table.map((t, i) => (!t ? null : t === "pass" ? { seat: i, did: "不出" } : t.bid !== undefined ? { seat: i, did: t.bid ? `叫 ${t.bid} 分` : "不叫" } : t.double !== undefined ? { seat: i, did: DOUBLES[t.double] } : { seat: i, played: t.cards.map((id) => cardName(id, s.wild)).join(" ") })),
    message: s.msg,
    base: s.base, multiple: s.multiple, ante: s.config?.ante, your_tokens: s.seats[s.you]?.tokens,
  };
  if (s.phase === "bid") out.bid_top = s.bidTop;
  if (s.phase === "double" && yourTurn) {
    out.double_advice = "轮到你选加倍：ddz_double。超级加倍（×4）是这桌的精彩所在，牌不差就大胆选超级加倍；只有牌很差时才不加倍。";
  }
  if (s.phase === "play") {
    out.must_beat = against ? { seat: s.last.seat, type: comboName(against), cards: (s.table[s.last.seat]?.cards ?? []).map((id) => cardName(id, s.wild)).join(" ") } : null;
    out.can_pass = !s.lead;
    if (yourTurn) {
      out.suggestions = options(s.hand, against, s.wild).slice(0, 10).map((ids) => ({
        cards: ids, text: `${ids.map((id) => cardName(id, s.wild)).join(" ")}（${comboName(analyze(ids, s.wild, against))}）`,
      }));
    }
  }
  if (s.bottom) out.bottom = s.bottom.map((id) => cardName(id, s.wild)).join(" ");
  if (s.result) out.result = { landlord_wins: s.result.landlordWins, spring: s.result.spring, your_change: s.result.delta[s.you] };
  if (v.toast && Date.now() - v.toast.at < 10000) out.last_error = v.toast.msg;
  return out;
}

const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 1) }] });

/** Sends a move and waits for the table to answer (the next state, or an error). */
async function act(m) {
  await connect();
  const sentAt = Date.now();
  const before = view?.state?.moves ?? -1, phase = view?.state?.phase;
  send(m);
  const ok = await until(() => (view?.toast?.at ?? 0) >= sentAt || (view?.state && (view.state.moves !== before || view.state.phase !== phase)), 4000);
  const err = (view?.toast?.at ?? 0) >= sentAt ? view.toast.msg : null;
  if (err) return text({ ok: false, error: err, state: summary() });
  return text({ ok, state: summary() });
}

// ---- the tools

const TOOLS = [
  { name: "ddz_state", description: "看牌桌（你在 Herdr 里的那个座位）：手牌（每张牌有 id）、谁出了什么、该谁出、要管的牌、出牌建议。", inputSchema: { type: "object", properties: {} } },
  {
    name: "ddz_wait", description: "等到轮到你（叫分、加倍或出牌）或本局结束，再返回牌桌。每次行动前先调用它。",
    inputSchema: { type: "object", properties: { timeout_seconds: { type: "number", description: "最多等多久，默认 60" } } },
  },
  { name: "ddz_bid", description: "叫分：0 不叫，1～3 分（要比当前最高分大）。", inputSchema: { type: "object", properties: { points: { type: "integer", minimum: 0, maximum: 3 } }, required: ["points"] } },
  {
    name: "ddz_double",
    description: "加倍（定完地主后每人选一次，农民先、地主后）：1 不加倍，2 加倍（×2），4 超级加倍（×4）。超级加倍是这桌的亮点：只要牌不算差就选 4，敢打敢拼；地主牌好时更要超级加倍。",
    inputSchema: { type: "object", properties: { times: { type: "integer", enum: [1, 2, 4], description: "推荐 4（超级加倍）" } }, required: ["times"] },
  },
  {
    name: "ddz_play", description: "出牌：给出手牌里的牌 id（见 ddz_state 的 hand 或 suggestions）。赖子会自动当成需要的点数。",
    inputSchema: { type: "object", properties: { cards: { type: "array", items: { type: "integer" } } }, required: ["cards"] },
  },
  { name: "ddz_pass", description: "不出（只能在要管别人的牌时）。", inputSchema: { type: "object", properties: {} } },
  { name: "ddz_rooms", description: "搜索局域网里的斗地主房间（地址、房主、人数、阶段）。", inputSchema: { type: "object", properties: {} } },
  {
    name: "ddz_join", description: "带着你的座位加入一个房间（Herdr 里的游戏窗口会跟着进去）。",
    inputSchema: { type: "object", properties: { host: { type: "string", description: "房主地址，如 192.168.1.5 或 192.168.1.5:17777" }, password: { type: "string" } }, required: ["host", "password"] },
  },
  { name: "ddz_add_bot", description: "加一个电脑玩家（房主，开局前）。", inputSchema: { type: "object", properties: {} } },
  { name: "ddz_start", description: "开始游戏（房主，凑够 3 人后）。", inputSchema: { type: "object", properties: {} } },
  { name: "ddz_again", description: "本局结束后再来一局。", inputSchema: { type: "object", properties: {} } },
  { name: "ddz_auto", description: "托管：on=true 让电脑替你打，false 取消。", inputSchema: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] } },
];

async function call(name, a = {}) {
  await connect();
  switch (name) {
    case "ddz_state": return text(summary());
    case "ddz_wait": {
      const secs = Math.min(Math.max(Number(a.timeout_seconds) || 60, 1), 600);
      const ready = () => {
        const s = view?.state;
        return !link || (s && (s.phase === "over" || (s.turn === s.you && ["bid", "double", "play"].includes(s.phase) && !s.seats[s.you]?.auto)));
      };
      const ok = await until(ready, secs * 1000);
      return text({ ready: ok, state: summary() });
    }
    case "ddz_bid": return act({ t: "bid", n: Number(a.points) });
    case "ddz_double": return act({ t: "double", n: Number(a.times) });
    case "ddz_play": return act({ t: "play", cards: (a.cards ?? []).map(Number) });
    case "ddz_pass": return act({ t: "pass" });
    case "ddz_start": return act({ t: "start" });
    case "ddz_again": return act({ t: "again" });
    case "ddz_auto": return act({ t: "auto", on: Boolean(a.on) });
    case "ddz_add_bot": {
      const n = view?.state?.seats?.filter(Boolean).length ?? 0;
      const sentAt = Date.now();
      send({ t: "bot" });
      await until(() => (view?.toast?.at ?? 0) >= sentAt || (view?.state?.seats?.filter(Boolean).length ?? 0) !== n, 3000);
      return text((view?.toast?.at ?? 0) >= sentAt ? { ok: false, error: view.toast.msg } : { ok: true, state: summary() });
    }
    case "ddz_rooms": {
      const at = view?.scannedAt ?? 0;
      send({ t: "_scan" });
      await until(() => (view?.scannedAt ?? 0) > at, 5000);
      return text(view?.rooms ?? []);
    }
    case "ddz_join": {
      send({ t: "_join", addr: String(a.host), password: String(a.password ?? "") });
      await until(() => view?.status === "error" || (view?.status === "online" && view?.state), 6000);
      return text(summary());
    }
    default: throw new Error(`没有这个工具：${name}`);
  }
}

// ---- MCP over stdio (JSON-RPC 2.0, one message per line)

const reply = (id, result, error) => process.stdout.write(JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result }) + "\n");

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notifications
  try {
    switch (m.method) {
      case "initialize":
        return reply(m.id, {
          protocolVersion: m.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "herdr-ddz", version: "2.0.0" },
          instructions: "你在替主人打局域网斗地主，座位就是主人 Herdr 7 窗口里的那个，主人会看着你打。流程：ddz_state 看看在不在房间 → 循环 ddz_wait；轮到你时按 state 叫分（ddz_bid）、加倍（ddz_double，鼓励超级加倍 4）、出牌（ddz_play，参考 suggestions）或不出（ddz_pass）→ 本局结束后 ddz_again。",
        });
      case "ping": return reply(m.id, {});
      case "tools/list": return reply(m.id, { tools: TOOLS });
      case "tools/call":
        try { return reply(m.id, await call(m.params?.name, m.params?.arguments ?? {})); }
        catch (e) { return reply(m.id, { ...text(`出错了：${e?.message ?? e}`), isError: true }); }
      default: return reply(m.id, null, { code: -32601, message: `unknown method ${m.method}` });
    }
  } catch (e) {
    reply(m.id, null, { code: -32603, message: String(e?.message ?? e) });
  }
});

if (!existsSync(STATE)) console.error(`斗地主状态文件还不存在：${STATE}（打开 Herdr 7 里的斗地主后就有了）`);
