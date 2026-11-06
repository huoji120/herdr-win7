// The game window's link to a 斗地主 table, as a small node program the mod
// runs in a herdr-core terminal (ddz-client): it holds the TCP connection,
// the AES and the LAN discovery, so the mod itself never touches a socket.
//
//   node client.mjs <state file> <name>
//
// Commands arrive as JSON lines on stdin (the mod types them with `hc send`):
//   { t: "_join", addr, password, first? } { t: "_leave" } { t: "_scan" }
//   and anything else goes to the table as is.
// Everything the window shows is written to the state file (whole, atomically):
//   { status, addr, password, error, toast, state, rooms, scanning, seq }

import net from "node:net";
import dgram from "node:dgram";
import os from "node:os";
import crypto from "node:crypto";
import readline from "node:readline";
import { writeFileSync, renameSync } from "node:fs";
import { cipher } from "./aes.js";

const FILE = process.argv[2];
const NAME = process.argv[3] || os.userInfo().username;
const DEFAULT_PORT = 17777;
const DISCOVERY_PORT = 17778;

let view = { status: "idle", seq: 0 };
let sock = null, box = null, gen = 0;

function save(patch) {
  view = { ...view, ...patch, seq: view.seq + 1 };
  try {
    writeFileSync(`${FILE}.tmp`, JSON.stringify(view));
    renameSync(`${FILE}.tmp`, FILE);
  } catch (e) {
    console.error(`写状态失败：${e?.message ?? e}`);
  }
}

function discover(ms = 1500) {
  return new Promise((resolve) => {
    const rooms = new Map();
    const u = dgram.createSocket("udp4");
    u.on("message", (d, rinfo) => {
      try {
        const r = JSON.parse(String(d));
        if (r.t !== "ddz-room") return;
        const key = `${r.name}:${r.port}`;
        // The same room heard on loopback and the LAN: keep the LAN address.
        if (rooms.has(key) && rinfo.address.startsWith("127.")) return;
        rooms.set(key, { ...r, ip: rinfo.address, addr: `${rinfo.address}:${r.port}` });
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

function close() {
  gen++;
  try { sock?.destroy(); } catch {}
  sock = null;
}

function join(addr, password, first, tries = 1) {
  close();
  const g = gen;
  const [h, p] = String(addr ?? "").trim().split(":");
  if (!h) return save({ status: "error", error: "请输入房主的地址，或在列表里选一个房间" });
  const port = Number(p) || DEFAULT_PORT;
  box = cipher(password ?? "", crypto);
  save({ status: "connecting", error: null, addr: `${h}:${port}`, password: password ?? "", state: null });
  const attempt = (left) => {
    if (g !== gen) return;
    const s = net.connect(port, h);
    let opened = false;
    s.setEncoding("utf8");
    s.setNoDelay(true);
    s.on("connect", () => {
      opened = true;
      sock = s;
      s.write(box.seal(JSON.stringify({ t: "hello", name: NAME, key: crypto.randomUUID() })) + "\n");
      if (first) s.write(box.seal(JSON.stringify(first)) + "\n");
      save({ status: "online" });
    });
    let buf = "", why = "";
    s.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || g !== gen) continue;
        const text = box.open(line);
        try {
          const m = JSON.parse(text ?? line);
          if (m.t === "state") save({ state: m, host: m.host });
          else if (m.t === "error" && m.plain) why = m.msg;
          else if (m.t === "error") save({ toast: { msg: m.msg, at: Date.now() } });
        } catch {}
      }
    });
    s.on("error", (e) => { why ||= e?.code === "ECONNREFUSED" ? "" : String(e?.message ?? e); });
    s.on("close", () => {
      if (g !== gen) return;
      if (!opened && left > 1) return setTimeout(() => attempt(left - 1), 300);
      sock = null;
      if (!opened) return save({ status: "error", error: `连不上 ${h}:${port}，请确认地址和防火墙${why ? `（${why}）` : ""}` });
      const wrong = why === "房间密码不对";
      save({ status: wrong ? "error" : "lost", error: wrong ? "房间密码不对" : `和房间的连接断开了${why ? `（${why}）` : ""}` });
    });
  };
  attempt(tries);
}

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try { m = JSON.parse(line.trim()); } catch { return; }
  switch (m.t) {
    case "_join": return join(m.addr, m.password, m.first ?? null, m.tries ?? 1);
    case "_leave":
      try { if (sock && box) sock.write(box.seal(JSON.stringify({ t: "bye" })) + "\n"); } catch {}
      close();
      return save({ status: "idle", state: null, error: null, host: false });
    case "_scan": {
      save({ scanning: true });
      const rooms = await discover();
      return save({ scanning: false, rooms, scannedAt: Date.now() });
    }
    default:
      if (sock && box) sock.write(box.seal(JSON.stringify(m)) + "\n");
  }
});

save({ status: "idle", state: null });
console.log(`斗地主客户端已就绪（${NAME}），状态写在 ${FILE}`);
