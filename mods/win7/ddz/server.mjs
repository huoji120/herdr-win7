// The 斗地主 table server for a LAN game. No dependencies:
//   node server.mjs [port] [password]
// Clients speak newline-delimited JSON over TCP, every line sealed with the
// room password (aes.js):
//   → { t: "hello", name, key, ai? } { t: "ctl", key } { t: "config", tokens, ante }
//     { t: "bot" } { t: "kick", seat } { t: "start" } { t: "bid", n } { t: "play", cards }
//     { t: "pass" } { t: "auto", on } { t: "again" } { t: "bye" }
//   ← { t: "state", ... } (each seat its own view), { t: "error", msg }, { t: "ping" }
// The server holds the cards, the rules and everyone's tokens; seat 0 is the
// host and sets the starting tokens and the ante. Each deal turns up a 赖子.
// A person has TURN_MS per turn (an AI player, joined through mcp.mjs,
// AI_TURN_MS): when it runs out the computer plays that turn, and after two
// in a row it takes over (托管) until they take it back. A seat whose player
// drops out mid-game is played by the computer until they return under the
// same name. LAN discovery answers on UDP DISCOVERY_PORT.

import net from "node:net";
import dgram from "node:dgram";
import os from "node:os";
import crypto from "node:crypto";
import { cipher } from "./aes.js";
import { analyze, readings, sortHand, botBid, botPlay, power, NAMES, BOMB_NAMES, rankLabel } from "./rules.js";

const PORT = Number(process.argv[2]) || 17777;
const PASSWORD = process.argv[3] ?? "";
const DISCOVERY_PORT = 17778;
const TURN_MS = 25000;
const AI_TURN_MS = 120000;
const BOT_NAMES = ["电脑·小红", "电脑·小明", "电脑·小刚"];
const box = cipher(PASSWORD, crypto);

/** @type {({ name: string, bot: boolean, ai?: boolean, sock: any, key?: string, tokens: number, auto: boolean, timeouts: number } | null)[]} */
const seats = [null, null, null];
const config = { tokens: 1000, ante: 10 };
let game = null;
let msg = "等待玩家加入";
let timer = null;
let scheduled = null;

const ips = () => Object.values(os.networkInterfaces()).flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);

const nameOf = (i) => seats[i]?.name ?? `座位${i + 1}`;
const human = (i) => seats[i] && !seats[i].bot && seats[i].sock && !seats[i].auto;

function view(i) {
  const g = game;
  return {
    t: "state", you: i, host: i === 0, port: PORT, ips: ips(), msg, config,
    seats: seats.map((s, j) => s && {
      name: s.name, bot: s.bot, ai: Boolean(s.ai), online: s.bot || Boolean(s.sock), tokens: s.tokens, auto: s.auto,
      cards: g ? g.hands[j].length : 0,
    }),
    phase: g?.phase ?? "lobby",
    moves: g?.moves ?? 0,
    turn: g?.turn ?? -1,
    wild: g?.wild ?? null,
    hand: g ? sortHand(g.hands[i], g.wild) : [],
    bottom: g && g.landlord >= 0 ? g.bottom : null,
    landlord: g?.landlord ?? -1,
    bidTop: g?.bidTop ?? 0,
    table: g?.table ?? [null, null, null],
    lead: g ? !g.last || g.last.seat === g.turn : true,
    last: g?.last ? { seat: g.last.seat, combo: g.last.combo } : null,
    base: g?.base ?? 0,
    multiple: g ? 2 ** g.bombs : 1,
    deadline: g && g.deadline && g.turn >= 0 ? Math.max(0, g.deadline - Date.now()) : null,
    result: g?.result ?? null,
    reveal: g?.phase === "over" ? g.hands.map((h) => sortHand(h, g.wild)) : null,
  };
}

function send(sock, m) {
  try { sock.write(box.seal(JSON.stringify(m)) + "\n"); } catch {}
}

function broadcast() {
  schedule();
  seats.forEach((s, i) => { if (s?.sock) send(s.sock, view(i)); });
}

// ---- the game

function deal() {
  const deck = Array.from({ length: 54 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const first = crypto.randomInt(3);
  const wild = 3 + crypto.randomInt(13);
  game = {
    phase: "bid", hands: [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)], bottom: deck.slice(51),
    wild, turn: first, moves: 0, deadline: null,
    bids: 0, bidTop: 0, bidBy: -1, landlord: -1, base: 0,
    last: null, passes: 0, table: [null, null, null], plays: [0, 0, 0], bombs: 0, result: null,
  };
  msg = `本局赖子是 ${rankLabel(wild)}，${nameOf(first)} 先叫分`;
}

function bid(i, n) {
  const g = game;
  if (g?.phase !== "bid" || g.turn !== i) return "还没轮到你";
  if (!(n === 0 || (Number.isInteger(n) && n > g.bidTop && n <= 3))) return "叫分无效";
  g.moves++;
  g.table[i] = { bid: n };
  g.bids++;
  if (n > 0) { g.bidTop = n; g.bidBy = i; }
  msg = n ? `${nameOf(i)} 叫 ${n} 分` : `${nameOf(i)} 不叫`;
  if (n === 3 || g.bids === 3) {
    if (g.bidBy < 0) { deal(); msg = `都不叫，重新发牌（赖子 ${rankLabel(game.wild)}）`; return null; }
    const l = g.bidBy;
    g.landlord = l;
    g.base = g.bidTop;
    g.hands[l].push(...g.bottom);
    g.phase = "play";
    g.turn = l;
    g.table = [null, null, null];
    msg = `${nameOf(l)} 是地主（${g.base} 分），请出牌`;
  } else g.turn = (i + 1) % 3;
  return null;
}

function play(i, cards) {
  const g = game;
  if (g?.phase !== "play" || g.turn !== i) return "还没轮到你";
  const hand = g.hands[i];
  if (!Array.isArray(cards) || !cards.length || new Set(cards).size !== cards.length || !cards.every((c) => hand.includes(c))) return "这些牌不在你手里";
  const against = g.last && g.last.seat !== i ? g.last.combo : null;
  const combo = analyze(cards, g.wild, against);
  if (!combo) return readings(cards, g.wild).length ? "管不住上家" : "不符合出牌规则";
  g.moves++;
  g.hands[i] = hand.filter((c) => !cards.includes(c));
  g.table[i] = { cards: sortHand(cards, g.wild), as: combo.as };
  g.last = { seat: i, combo };
  g.passes = 0;
  g.plays[i]++;
  if (power(combo)) g.bombs++;
  msg = `${nameOf(i)} 出 ${combo.type === "bomb" ? BOMB_NAMES[combo.kind] : NAMES[combo.type]}`;
  if (!g.hands[i].length) return finish(i);
  g.turn = (i + 1) % 3;
  g.table[g.turn] = null;
  return null;
}

function pass(i) {
  const g = game;
  if (g?.phase !== "play" || g.turn !== i) return "还没轮到你";
  if (!g.last || g.last.seat === i) return "你先出，不能不出";
  g.moves++;
  g.table[i] = "pass";
  g.passes++;
  msg = `${nameOf(i)} 不出`;
  if (g.passes === 2) {
    g.turn = g.last.seat;
    g.last = null;
    g.passes = 0;
    g.table = [null, null, null];
    msg = `${nameOf(g.turn)} 出牌`;
  } else {
    g.turn = (i + 1) % 3;
    g.table[g.turn] = null;
  }
  return null;
}

/** Tokens change hands: base × multiple × ante a farmer, the landlord twice that; nobody pays more than they have. */
function finish(winner) {
  const g = game;
  const l = g.landlord;
  const landlordWins = winner === l;
  const farmers = [0, 1, 2].filter((j) => j !== l);
  const spring = landlordWins ? farmers.every((j) => g.plays[j] === 0) : g.plays[l] === 1;
  const multiple = 2 ** g.bombs * (spring ? 2 : 1);
  const unit = g.base * multiple * config.ante;
  const delta = [0, 0, 0];
  if (landlordWins) {
    for (const f of farmers) {
      const pay = Math.min(unit, seats[f].tokens);
      delta[f] -= pay;
      delta[l] += pay;
    }
  } else {
    const total = Math.min(2 * unit, seats[l].tokens);
    delta[l] -= total;
    delta[farmers[0]] += Math.ceil(total / 2);
    delta[farmers[1]] += Math.floor(total / 2);
  }
  delta.forEach((d, j) => { seats[j].tokens += d; });
  g.phase = "over";
  g.turn = -1;
  g.deadline = null;
  g.result = { landlordWins, spring, multiple, base: g.base, ante: config.ante, delta };
  const broke = seats.filter((s) => s.tokens <= 0).map((s) => s.name);
  msg = `${landlordWins ? "地主" : "农民"}胜利${spring ? "（春天！）" : ""}${broke.length ? `，${broke.join("、")} 破产了` : ""}`;
  return null;
}

// ---- turns the computer plays: computer seats, 托管, dropped players, and a person's turn that ran out

function autoMove(i) {
  try {
    move(i);
  } catch (e) {
    // Never leave a table stuck on a turn: pass, or play the lowest card.
    console.error(`代打出错（座位 ${i}）：${e?.stack ?? e}`);
    if (pass(i) && game.phase === "play") play(i, [sortHand(game.hands[i], game.wild).at(-1)]);
  }
}

function move(i) {
  const g = game;
  if (g.phase === "bid") return bid(i, botBid(g.hands[i], g.bidTop, g.wild));
  const last = g.last && g.last.seat !== i ? g.last : null;
  const mate = Boolean(last) && i !== g.landlord && last.seat !== g.landlord;
  const cards = botPlay(g.hands[i], last?.combo ?? null, mate, last ? g.hands[last.seat].length : 17, g.wild);
  if (!cards || play(i, cards)) pass(i);
}

/** One timer for whoever's turn it is, set again only when the turn changes. */
function schedule() {
  const g = game;
  const key = g && g.phase !== "over" && g.turn >= 0 ? `${g.moves}:${g.turn}:${human(g.turn) ? "p" : "c"}` : null;
  if (key === scheduled) return;
  scheduled = key;
  clearTimeout(timer);
  timer = null;
  if (!key) return;
  const i = g.turn;
  if (human(i)) {
    const ms = seats[i].ai ? AI_TURN_MS : TURN_MS;
    g.deadline = Date.now() + ms;
    timer = setTimeout(() => {
      timer = null;
      if (game !== g || g.turn !== i || !human(i)) return;
      const s = seats[i];
      s.timeouts++;
      autoMove(i);
      if (s.timeouts >= 2) { s.auto = true; msg = `${s.name} 超时两次，已托管`; }
      broadcast();
    }, ms);
  } else {
    g.deadline = null;
    timer = setTimeout(() => {
      timer = null;
      if (game !== g || g.turn !== i || human(i)) return;
      autoMove(i);
      broadcast();
    }, 700 + Math.random() * 700);
  }
}

// ---- connections
//
// A player keeps two sockets: the feed, where they said hello and the server
// talks (states, errors, a ping every 3 s), and a control socket that only
// sends ({ t: "ctl", key } first). One socket can do both (node clients).

function join(sock, m) {
  let name = String(m.name || "玩家").slice(0, 16);
  // Back under the same name: the seat the computer has been keeping.
  let i = seats.findIndex((s) => s && !s.bot && !s.sock && s.name === name);
  if (i < 0) {
    if (seats.some((s) => s && s.name === name)) name = `${name}${crypto.randomInt(10, 100)}`;
    const open = !game || game.phase === "over";
    i = open ? seats.findIndex((s) => !s) : -1;
    if (i < 0 && open) i = seats.findIndex((s) => s?.bot);
    if (i < 0) {
      send(sock, { t: "error", msg: open ? "房间已满" : "牌局进行中，请稍后再来" });
      return sock.end();
    }
    seats[i] = { name, bot: false, sock: null, tokens: config.tokens, auto: false, timeouts: 0 };
  }
  Object.assign(seats[i], { sock, key: String(m.key ?? ""), ai: Boolean(m.ai) });
  sock.seat = i;
  msg = `${name}${m.ai ? "（AI）" : ""} 进入了房间`;
  broadcast();
}

/** The seat a socket speaks for: its feed, or a control socket holding the seat's key. */
function seatOf(sock) {
  const i = sock.seat;
  if (i === undefined || i < 0 || !seats[i]) return -1;
  if (seats[i].sock === sock) return i;
  return sock.ctl && sock.key && seats[i].key === sock.key ? i : -1;
}

function handle(sock, m) {
  if (m.t === "hello") return join(sock, m);
  if (m.t === "ctl") {
    sock.ctl = true;
    sock.key = String(m.key ?? "");
    sock.seat = seats.findIndex((s) => s && s.key && s.key === sock.key);
    return;
  }
  const i = seatOf(sock);
  if (i < 0) return;
  const s = seats[i];
  const idle = !game || game.phase === "over";
  let err = null;
  switch (m.t) {
    case "config": {
      if (i !== 0) { err = "只有房主能设置筹码"; break; }
      if (!idle) { err = "牌局进行中"; break; }
      const tokens = Math.floor(Number(m.tokens)), ante = Math.floor(Number(m.ante));
      if (!(tokens > 0 && tokens <= 1e9 && ante > 0 && ante <= tokens)) { err = "筹码或底注无效"; break; }
      config.tokens = tokens;
      config.ante = ante;
      for (const x of seats) if (x) x.tokens = tokens;
      msg = `房主设置：每人 ${tokens} 筹码，底注 ${ante}`;
      break;
    }
    case "bot": {
      if (i !== 0) { err = "只有房主能添加电脑"; break; }
      if (!idle) { err = "牌局进行中"; break; }
      const k = seats.findIndex((x) => !x);
      if (k < 0) { err = "房间已满"; break; }
      const used = new Set(seats.map((x) => x?.name));
      seats[k] = { name: BOT_NAMES.find((n) => !used.has(n)) ?? "电脑", bot: true, sock: null, tokens: config.tokens, auto: false, timeouts: 0 };
      msg = `${seats[k].name} 加入了房间`;
      break;
    }
    case "kick":
      if (i !== 0 || !seats[m.seat]?.bot || !idle) { err = "不能移除"; break; }
      seats[m.seat] = null;
      game = null;
      msg = "已移除电脑玩家";
      break;
    case "start":
    case "again": {
      if (seats.some((x) => !x)) { err = "需要 3 名玩家"; break; }
      if (!idle) { err = "牌局进行中"; break; }
      const broke = seats.find((x) => x.tokens <= 0);
      if (broke) { err = `${broke.name} 的筹码不足，房主可以重新设置筹码`; break; }
      deal();
      break;
    }
    case "auto":
      s.auto = Boolean(m.on);
      s.timeouts = 0;
      scheduled = null;
      msg = s.auto ? `${s.name} 开启了托管` : `${s.name} 取消了托管`;
      break;
    case "bid": err = bid(i, m.n); if (!err) s.timeouts = 0; break;
    case "play": err = play(i, m.cards); if (!err) s.timeouts = 0; break;
    case "pass": err = pass(i); if (!err) s.timeouts = 0; break;
    case "bye": s.sock?.end(); return;
    default: return;
  }
  if (err) { if (s.sock) send(s.sock, { t: "error", msg: err }); }
  else broadcast();
}

function leave(sock) {
  const i = sock.seat;
  if (i === undefined || i < 0 || seats[i]?.sock !== sock) return;
  if (game && game.phase !== "over") {
    seats[i].sock = null;
    msg = `${seats[i].name} 掉线了，电脑代打`;
  } else {
    msg = `${seats[i].name} 离开了房间`;
    seats[i] = null;
    game = null;
  }
  broadcast();
}

const server = net.createServer((sock) => {
  sock.setEncoding("utf8");
  sock.setNoDelay(true);
  let buf = "";
  sock.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const text = box.open(line);
      if (text === null) {
        // Not our password: say so in the clear, and hang up.
        try { sock.write(JSON.stringify({ t: "error", msg: "房间密码不对", plain: true }) + "\n"); } catch {}
        sock.end();
        return;
      }
      try {
        handle(sock, JSON.parse(text));
      } catch (e) {
        const i = seatOf(sock);
        if (i >= 0 && seats[i].sock) send(seats[i].sock, { t: "error", msg: String(e?.message ?? e) });
      }
    }
  });
  sock.on("close", () => leave(sock));
  sock.on("error", () => {});
});

// A ping on every feed, so a client's read never sits idle long enough to time out.
// And a watchdog: a game whose turn has no timer behind it gets one.
setInterval(() => {
  for (const s of seats) if (s?.sock) send(s.sock, { t: "ping" });
  if (game && game.phase !== "over" && game.turn >= 0 && !timer) { scheduled = null; broadcast(); }
}, 3000);

// LAN discovery: "herdr-ddz?" on UDP gets the room, in the clear (nothing secret in it).
const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
udp.on("message", (data, rinfo) => {
  if (String(data).trim() !== "herdr-ddz?") return;
  const room = { t: "ddz-room", v: 1, port: PORT, name: seats[0]?.name ?? "斗地主", players: seats.filter(Boolean).length, phase: game?.phase ?? "lobby" };
  udp.send(JSON.stringify(room), rinfo.port, rinfo.address);
});
udp.on("error", (e) => console.error(`局域网发现不可用：${e?.message ?? e}`));
udp.bind(DISCOVERY_PORT);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`斗地主房间已开在端口 ${PORT}（局域网发现端口 ${DISCOVERY_PORT}）`);
  for (const ip of ips()) console.log(`  也可以手动输入: ${ip}:${PORT}`);
});
server.on("error", (e) => { console.error(String(e?.message ?? e)); process.exit(1); });
