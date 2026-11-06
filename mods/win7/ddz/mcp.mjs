#!/usr/bin/env node
// 斗地主 for AI players: an MCP server (stdio) that takes a seat at a LAN
// table and gives the agent tools to see its cards and play them. Add it to
// an agent, e.g. Claude Code:
//
//   claude mcp add ddz -- node <this file> --password 123456 [--host 192.168.1.5] [--name 我的AI]
//
// Without --host it finds the room on the LAN (or use the ddz_rooms tool).
// The agent's seat gets a longer clock than a person's (AI_TURN_MS on the
// server). No dependencies.

import net from "node:net";
import dgram from "node:dgram";
import os from "node:os";
import crypto from "node:crypto";
import readline from "node:readline";
import { cipher } from "./aes.js";
import { analyze, options, isWild, rank, rankLabel, SUITS, NAMES, BOMB_NAMES } from "./rules.js";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DEFAULT_PORT = 17777;
const DISCOVERY_PORT = 17778;

let sock = null, box = null, state = null, lastError = null, joinedAs = null;
const listeners = new Set();
const changed = () => { for (const f of [...listeners]) f(); };

// ---- the table

function discover(ms = 1500) {
  return new Promise((resolve) => {
    const rooms = new Map();
    const u = dgram.createSocket("udp4");
    u.on("message", (d, rinfo) => {
      try {
        const r = JSON.parse(String(d));
        if (r.t === "ddz-room") rooms.set(`${rinfo.address}:${r.port}`, { ...r, addr: `${rinfo.address}:${r.port}` });
      } catch {}
    });
    u.on("error", () => {});
    u.bind(0, () => {
      u.setBroadcast(true);
      const targets = new Set(["255.255.255.255", "127.0.0.1"]);
      for (const a of Object.values(os.networkInterfaces()).flat()) {
        if (!a || a.family !== "IPv4" || a.internal || !a.netmask) continue;
        const ip = a.address.split(".").map(Number), m = a.netmask.split(".").map(Number);
        targets.add(ip.map((b, i) => b | (255 ^ m[i])).join("."));
      }
      for (const t of targets) u.send("herdr-ddz?", DISCOVERY_PORT, t, () => {});
    });
    setTimeout(() => { try { u.close(); } catch {} resolve([...rooms.values()]); }, ms);
  });
}

function send(m) {
  if (!sock || !box) throw new Error("还没有加入房间：先调用 ddz_join");
  sock.write(box.seal(JSON.stringify(m)) + "\n");
}

async function join(host, password, name) {
  if (!host) {
    const rooms = (await discover()).filter((r) => r.phase === "lobby" || r.phase === "over");
    if (!rooms.length) throw new Error("局域网里没有找到斗地主房间，请传 host");
    host = rooms.find((r) => !r.addr.startsWith("127."))?.addr ?? rooms[0].addr;
  }
  const [h, p] = String(host).split(":");
  try { sock?.destroy(); } catch {}
  box = cipher(password ?? "", crypto);
  state = null;
  lastError = null;
  await new Promise((resolve, reject) => {
    const s = net.connect(Number(p) || DEFAULT_PORT, h, () => resolve());
    s.once("error", reject);
    sock = s;
  });
  sock.setEncoding("utf8");
  let buf = "";
  sock.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const text = box.open(line);
      try {
        const m = JSON.parse(text ?? line);
        if (m.t === "state") { state = m; changed(); }
        else if (m.t === "error") { lastError = m.msg; changed(); }
      } catch {}
    }
  });
  sock.on("close", () => { sock = null; changed(); });
  sock.on("error", () => {});
  joinedAs = name || `AI-${os.hostname()}`;
  sock.write(box.seal(JSON.stringify({ t: "hello", name: joinedAs, key: crypto.randomUUID(), ai: true })) + "\n");
  await until(() => state || lastError || !sock, 5000);
  if (!state) throw new Error(lastError ?? "加入失败（密码不对，或房间满了）");
  return `${h}:${Number(p) || DEFAULT_PORT}`;
}

function until(test, ms) {
  return new Promise((resolve) => {
    if (test()) return resolve(true);
    const done = (v) => { listeners.delete(check); clearTimeout(t); resolve(v); };
    const check = () => { if (test()) done(true); };
    const t = setTimeout(() => done(false), ms);
    listeners.add(check);
  });
}

// ---- what the agent reads

const cardName = (id, wild) => {
  if (id === 52) return "小王";
  if (id === 53) return "大王";
  return `${SUITS[id % 4]}${rankLabel(rank(id))}${isWild(id, wild) ? "(赖)" : ""}`;
};
const comboName = (c) => (!c ? "" : c.type === "bomb" ? BOMB_NAMES[c.kind] : NAMES[c.type]);

function summary() {
  if (!state) return { joined: false, hint: "先调用 ddz_join（或 ddz_rooms 找房间）" };
  const s = state;
  const roleOf = (i) => (s.landlord < 0 ? null : s.landlord === i ? "地主" : "农民");
  const against = s.lead ? null : s.last?.combo ?? null;
  const yourTurn = s.turn === s.you && (s.phase === "bid" || s.phase === "play");
  const out = {
    phase: { lobby: "等待开始", bid: "叫分", play: "出牌", over: "本局结束" }[s.phase] ?? s.phase,
    you: s.you,
    your_role: roleOf(s.you),
    your_turn: yourTurn,
    seconds_left: yourTurn && s.deadline != null ? Math.round(s.deadline / 1000) : null,
    wild: s.wild != null ? `${rankLabel(s.wild)}（赖子，可当 3～2 任意点数）` : null,
    hand: s.hand.map((id) => ({ id, card: cardName(id, s.wild) })),
    players: s.seats.map((p, i) => p && { seat: i, name: p.name, role: roleOf(i), cards: p.cards, tokens: p.tokens, ai: p.ai, bot: p.bot }),
    table: s.table.map((t, i) => (!t ? null : t === "pass" ? { seat: i, played: "不出" } : t.bid !== undefined ? { seat: i, bid: t.bid } : { seat: i, played: t.cards.map((id) => cardName(id, s.wild)).join(" ") })),
    message: s.msg,
    base: s.base, multiple: s.multiple, ante: s.config?.ante,
  };
  if (s.phase === "bid") out.bid_top = s.bidTop;
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
  if (lastError) out.last_error = lastError;
  return out;
}

const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 1) }] });

async function act(m) {
  lastError = null;
  const before = state?.moves ?? -1, phase = state?.phase;
  send(m);
  await until(() => lastError || (state && (state.moves !== before || state.phase !== phase)), 3000);
  if (lastError) return text({ ok: false, error: lastError, state: summary() });
  return text({ ok: true, state: summary() });
}

// ---- the tools

const TOOLS = [
  { name: "ddz_rooms", description: "列出局域网里的斗地主房间（地址、房主、人数、阶段）。", inputSchema: { type: "object", properties: {} } },
  {
    name: "ddz_join", description: "加入一个斗地主房间。不给 host 就自动找局域网里的房间。password 是房主告诉你的房间密码。",
    inputSchema: { type: "object", properties: { host: { type: "string", description: "房主地址，如 192.168.1.5 或 192.168.1.5:17777" }, password: { type: "string" }, name: { type: "string", description: "你在牌桌上的名字" } } },
  },
  { name: "ddz_state", description: "看牌桌：你的手牌（每张牌有 id）、谁出了什么、该谁出、要管的牌、出牌建议。", inputSchema: { type: "object", properties: {} } },
  {
    name: "ddz_wait", description: "等到轮到你（叫分或出牌）或本局结束，再返回牌桌。每次行动前先调用它。",
    inputSchema: { type: "object", properties: { timeout_seconds: { type: "number", description: "最多等多久，默认 60" } } },
  },
  { name: "ddz_bid", description: "叫分：0 不叫，1～3 分（要比当前最高分大）。", inputSchema: { type: "object", properties: { points: { type: "integer", minimum: 0, maximum: 3 } }, required: ["points"] } },
  {
    name: "ddz_play", description: "出牌：给出手牌里的牌 id（见 ddz_state 的 hand 或 suggestions）。赖子会自动当成需要的点数。",
    inputSchema: { type: "object", properties: { cards: { type: "array", items: { type: "integer" } } }, required: ["cards"] },
  },
  { name: "ddz_pass", description: "不出（只能在要管别人的牌时）。", inputSchema: { type: "object", properties: {} } },
  { name: "ddz_add_bot", description: "加一个电脑玩家（房主，开局前）。", inputSchema: { type: "object", properties: {} } },
  { name: "ddz_start", description: "开始游戏（房主，凑够 3 人后）。", inputSchema: { type: "object", properties: {} } },
  { name: "ddz_again", description: "本局结束后再来一局。", inputSchema: { type: "object", properties: {} } },
  { name: "ddz_auto", description: "托管：on=true 让电脑替你打，false 取消。", inputSchema: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] } },
  { name: "ddz_leave", description: "离开房间。", inputSchema: { type: "object", properties: {} } },
];

async function call(name, a = {}) {
  switch (name) {
    case "ddz_rooms": return text(await discover());
    case "ddz_join": {
      const addr = await join(a.host ?? arg("host"), a.password ?? arg("password", ""), a.name ?? arg("name"));
      return text({ joined: addr, as: joinedAs, state: summary() });
    }
    case "ddz_state": return text(summary());
    case "ddz_wait": {
      if (!state && arg("password") !== null) await join(arg("host"), arg("password", ""), arg("name"));
      const secs = Math.min(Math.max(Number(a.timeout_seconds) || 60, 1), 600);
      const ready = () => !sock || (state && (state.phase === "over" || (state.turn === state.you && (state.phase === "bid" || state.phase === "play") && !state.seats[state.you]?.auto)));
      const ok = await until(ready, secs * 1000);
      return text({ ready: ok, connected: Boolean(sock), state: summary() });
    }
    case "ddz_bid": return act({ t: "bid", n: Number(a.points) });
    case "ddz_play": return act({ t: "play", cards: (a.cards ?? []).map(Number) });
    case "ddz_pass": return act({ t: "pass" });
    case "ddz_add_bot": {
      lastError = null;
      const n = state?.seats.filter(Boolean).length ?? 0;
      send({ t: "bot" });
      await until(() => lastError || (state && state.seats.filter(Boolean).length !== n), 3000);
      return text(lastError ? { ok: false, error: lastError } : { ok: true, state: summary() });
    }
    case "ddz_start": return act({ t: "start" });
    case "ddz_again": return act({ t: "again" });
    case "ddz_auto": return act({ t: "auto", on: Boolean(a.on) });
    case "ddz_leave": { try { send({ t: "bye" }); sock?.end(); } catch {} state = null; return text("已离开房间"); }
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
          serverInfo: { name: "herdr-ddz", version: "1.0.0" },
          instructions: "局域网斗地主。流程：ddz_join 入座 → 循环 ddz_wait，轮到你时按 state 里的 hand / must_beat / suggestions 用 ddz_bid、ddz_play 或 ddz_pass 行动 → 本局结束后 ddz_again。",
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
