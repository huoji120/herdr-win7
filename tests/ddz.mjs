// 斗地主 end to end: the rules (赖子 too), then one scripted person and two
// computer players against the server for several games, the last ones
// under 托管. node extensions/win7/tests/ddz.mjs
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crypto from "node:crypto";
import dgram from "node:dgram";
import { analyze, beats, options, botPlay, botBid, power } from "../mods/win7/ddz/rules.js";
import { cipher } from "../mods/win7/ddz/aes.js";

const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };

// ---- rules: a card id of rank r (copy k), jokers 16 and 17
const C = (r, k = 0) => (r >= 16 ? r + 36 : (r - 3) * 4 + k);
const many = (r, n) => Array.from({ length: n }, (_, k) => C(r, k));
const t = (ids, wild = null, last = null) => analyze(ids, wild, last)?.type ?? null;

assert(t([C(16), C(17)]) === "rocket", "rocket");
assert(t(many(3, 4)) === "bomb" && analyze(many(3, 4)).kind === "hard", "hard bomb");
assert(t([3, 4, 5, 6, 7].map((r) => C(r))) === "straight", "straight");
assert(t([10, 11, 12, 13, 14].map((r) => C(r))) === "straight", "straight to A");
assert(t([11, 12, 13, 14, 15].map((r) => C(r))) === null, "no straight through 2");
assert(t([...many(3, 2), ...many(4, 2), ...many(5, 2)]) === "pairs", "pairs");
assert(t([...many(3, 3), C(8)]) === "triple1", "triple1");
assert(t([...many(3, 3), ...many(9, 2)]) === "triple2", "triple2");
assert(t([...many(3, 3), ...many(4, 3)]) === "plane", "plane");
assert(t([...many(3, 3), ...many(4, 3), C(8), C(13)]) === "plane1", "plane1");
assert(t([...many(3, 3), ...many(4, 3), ...many(9, 2), ...many(10, 2)]) === "plane2", "plane2");
assert(t([...many(3, 4), C(8), C(13)]) === "four2", "four2");
assert(beats(analyze(many(3, 4)), analyze([C(15)])), "bomb beats single");
assert(!beats(analyze([C(4)]), analyze([C(5)])), "4 < 5");
assert(beats(analyze([C(16), C(17)]), analyze(many(3, 4))), "rocket beats bomb");
assert(options([C(3), C(5), C(9)], analyze([C(4)])).length === 2, "two singles beat a 4");

// 赖子 = 7
const W = 7;
assert(t([C(3), C(7)], W) === "pair", "赖子 makes a pair");
const soft = analyze([...many(9, 3), C(7)], W);
assert(soft.type === "bomb" && soft.kind === "soft" && soft.main === 9, "soft bomb");
assert(analyze(many(7, 4), W).kind === "wild", "four 赖子");
assert(beats(analyze(many(3, 4), W), soft), "hard 3s beat soft 9s");
assert(beats(analyze(many(7, 4), W), analyze(many(14, 4), W)), "赖子 bomb beats hard A");
assert(!beats(soft, analyze(many(3, 4), W)), "soft below hard");
assert(t([C(3), C(4), C(5), C(6), C(7)], W) === "straight", "赖子 fills or stands in a straight");
const s = analyze([C(8), C(9), C(10), C(7), C(12)], W, analyze([3, 4, 5, 6, 7].map((r) => C(r))));
assert(s?.type === "straight" && s.main === 12 && s.as[C(7)] === 11, "赖子 becomes the missing J");
assert(options([C(3), C(7, 1)], analyze([C(5), C(5, 1)]), W).length === 0, "3 + 赖子 can't beat 55");
assert(options([C(6), C(7, 1)], analyze([C(5), C(5, 1)]), W).some((o) => o.length === 2), "6 + 赖子 beats 55");
assert(power(analyze([C(16), C(17)])) === 4, "rocket power");
assert(botBid([C(16), C(17), C(15), C(15, 1), C(15, 2)], 0) === 3, "strong hand bids 3");
assert(botPlay([C(3)], null, false, 17).length === 1, "bot leads");
console.log("rules ok");

// ---- against the server
const here = dirname(fileURLToPath(import.meta.url));
const port = 17000 + Math.floor(Math.random() * 900);
const PASSWORD = "246810";
const box = cipher(PASSWORD, crypto);
const server = spawn(process.execPath, [join(here, "../mods/win7/ddz/server.mjs"), String(port), PASSWORD], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.once("data", r));

// Discovery answers on UDP, and a wrong password is turned away in the clear.
const room = await new Promise((resolve, reject) => {
  const u = dgram.createSocket("udp4");
  u.on("message", (d) => { u.close(); resolve(JSON.parse(String(d))); });
  u.bind(0, () => u.send("herdr-ddz?", 17778, "127.0.0.1"));
  setTimeout(() => reject(new Error("no discovery answer")), 3000);
});
assert(room.t === "ddz-room" && room.port === port, "discovery");
const refused = await new Promise((resolve) => {
  const w = net.connect(port, "127.0.0.1", () => w.write(cipher("000000", crypto).seal(JSON.stringify({ t: "hello", name: "x" })) + "\n"));
  w.setEncoding("utf8");
  w.on("data", (d) => { resolve(JSON.parse(d.split("\n")[0])); w.destroy(); });
});
assert(refused.plain && refused.msg === "房间密码不对", "wrong password refused");
console.log("discovery and password ok");

const sock = net.connect(port, "127.0.0.1");
sock.setEncoding("utf8");
const send = (m) => sock.write(box.seal(JSON.stringify(m)) + "\n");
send({ t: "hello", name: "测试" });
const GAMES = 4;
let buf = "", games = 0, plays = 0, last = null, configured = false, autoOn = false, wilds = new Set();
const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out")), 180000);
  sock.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(box.open(buf.slice(0, nl)));
      buf = buf.slice(nl + 1);
      if (m.t === "ping") continue;
      if (m.t === "error") { clearTimeout(timer); return reject(new Error(m.msg)); }
      last = m;
      if (m.wild) wilds.add(m.wild);
      const n = m.seats.filter(Boolean).length;
      if (m.phase === "lobby" && !configured) { configured = true; send({ t: "config", tokens: 500, ante: 5 }); }
      else if (m.phase === "lobby" && n < 3 && m.msg.includes("房主设置") ) { send({ t: "bot" }); send({ t: "bot" }); }
      else if (m.phase === "lobby" && n === 3) send({ t: "start" });
      else if (m.phase === "over") {
        if (m.msg.includes("胜利") && last.result) {
          games++;
          const total = m.seats.reduce((a, x) => a + x.tokens, 0);
          assert(total === 1500, `tokens are conserved (${total})`);
          assert(m.result.delta.reduce((a, b) => a + b, 0) === 0, "deltas sum to zero");
          console.log(`game ${games}: ${m.msg} 赖子 ${m.wild} ×${m.result.multiple} base ${m.result.base} ante ${m.result.ante}, delta ${m.result.delta.join("/")}, tokens ${m.seats.map((x) => x.tokens).join("/")}`);
          if (games === GAMES) { clearTimeout(timer); return resolve(); }
          if (games === GAMES - 2) { autoOn = true; send({ t: "auto", on: true }); }
          send({ t: "again" });
        }
      } else if (m.turn === m.you && !autoOn) {
        assert(m.deadline > 0, "a person's turn has a deadline");
        if (m.phase === "bid") send({ t: "bid", n: botBid(m.hand, m.bidTop, m.wild) });
        else {
          const against = m.lead ? null : m.last.combo;
          const cards = botPlay(m.hand, against, false, 17, m.wild);
          plays++;
          send(cards ? { t: "play", cards } : { t: "pass" });
        }
      }
    }
  });
});
try {
  await done;
  console.log(`server ok: ${games} games (last 2 under 托管), ${plays} turns by the scripted seat, 赖子 seen: ${[...wilds].join(",")}`);
} catch (e) {
  console.error("FAIL:", e.message, JSON.stringify(last)?.slice(0, 800));
  process.exitCode = 1;
} finally {
  sock.destroy();
  server.kill();
}
