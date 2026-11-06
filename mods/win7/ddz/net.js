// The 斗地主 link, kept by the taskbar. The mod never opens a socket itself:
// a node program, client.mjs, runs in a herdr-core terminal (ddz-client) and
// holds the connection, the AES and the LAN discovery. The taskbar types
// commands into it (`hc send`) and reads back what it writes to
// data/ddz/state.json. So a reload of this mod, or closing the game window,
// keeps your seat. The window talks to the taskbar through shared state:
//   "win7.ddz"      what client.mjs wrote: { status, addr, password, error, toast, state, rooms, scanning }
//   "win7.ddz.out"  messages queued for the table, plus "_host" / "_join" / "_leave" / "_scan"
// Hosting also runs the server (server.mjs) as the terminal ddz-server.
// Both need node.

import * as fs from "fs/promises";
import { randomBytes } from "crypto";
import { shared, setShared, hc, appHome, home, readTextFile, watchFolder } from "herdr";

export const DDZ = "win7.ddz";
export const DDZ_OUT = "win7.ddz.out";
const HOSTING = "win7.ddz.hosting";
export const PORT = 17777;

/** Queues a message for the table (from the game window, or anything). */
export function ddzSend(m) {
  setShared(DDZ_OUT, [...(shared(DDZ_OUT) ?? []), m]);
}

export const ddz = () => ({ status: "idle", ...(shared(DDZ) ?? {}), host: Boolean(shared(HOSTING)) });

const playerName = () => (home() ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "玩家";
const newPassword = () => { const b = randomBytes(3); return String(100000 + ((b[0] << 16) | (b[1] << 8) | b[2]) % 900000); };
const dir = () => `${appHome()}/data/ddz`;
const script = (name) => `${appHome()}/mods/win7/ddz/${name}`;

function wait(cx, ms) {
  return new Promise((resolve) => cx.timer.after(ms, () => resolve()));
}

async function alive(name) {
  try {
    const r = await hc(["get", name, "--json"]);
    return r.code === 0 && JSON.parse(r.stdout)?.state === "live";
  } catch {
    return false;
  }
}

export class DdzLink {
  constructor() {
    this.seq = -1;
    this.queue = [];
    this.busy = false;
  }

  /** Taskbar init: follow the state file. */
  start(cx) {
    cx.spawn(async () => {
      try { await fs.mkdir(dir(), { recursive: true }); } catch {}
      // No client running (Herdr restarted, the computer too): nothing is connected.
      if (!(await alive("ddz-client"))) {
        setShared(DDZ, { status: "idle", rooms: shared(DDZ)?.rooms ?? [] });
        if (!(await alive("ddz-server"))) setShared(HOSTING, false);
      } else await this.load();
      for (;;) {
        try { await watchFolder(dir()); } catch { return; }
        await this.load();
      }
    });
  }

  async load() {
    try {
      const text = await readTextFile(`${dir()}/state.json`);
      if (!text) return;
      const v = JSON.parse(text);
      if (v.seq === this.seq) return;
      this.seq = v.seq;
      setShared(DDZ, v);
    } catch {}
  }

  /** Taskbar render: hands queued messages on, one at a time, in order. */
  pump(cx) {
    const out = shared(DDZ_OUT);
    if (!out?.length) return;
    setShared(DDZ_OUT, []);
    this.queue.push(...out);
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      while (this.queue.length) {
        try { await this.handle(cx, this.queue.shift()); } catch {}
      }
      this.busy = false;
    });
  }

  async client(cx) {
    if (await alive("ddz-client")) return true;
    const r = await hc(["run", "--bg", "--no-parent", "--name", "ddz-client", "--", "node", script("client.mjs"), `${dir()}/state.json`, playerName()]);
    if (r.code !== 0) {
      setShared(DDZ, { ...ddz(), status: "error", error: `斗地主客户端没有启动（需要安装 node）：${(r.stderr || r.stdout || "").trim()}` });
      return false;
    }
    await wait(cx, 700);
    return true;
  }

  async send(cx, m) {
    if (!(await this.client(cx))) return;
    await hc(["send", "ddz-client", JSON.stringify(m)]);
  }

  async handle(cx, m) {
    if (m.t === "_host") {
      const password = String(m.password ?? "").trim() || newPassword();
      setShared(HOSTING, true);
      setShared(DDZ, { ...ddz(), status: "connecting", error: null, state: null, password });
      try { await hc(["kill", "ddz-server"]); } catch {}
      const r = await hc(["run", "--bg", "--no-parent", "--rm", "--name", "ddz-server", "--", "node", script("server.mjs"), String(PORT), password]);
      if (r.code !== 0) {
        setShared(HOSTING, false);
        return setShared(DDZ, { ...ddz(), status: "error", error: `房间没有开起来（需要安装 node）：${(r.stderr || r.stdout || "").trim()}` });
      }
      return this.send(cx, { t: "_join", addr: `127.0.0.1:${PORT}`, password, tries: 20, first: { t: "config", tokens: m.tokens, ante: m.ante } });
    }
    if (m.t === "_leave") {
      await this.send(cx, m);
      // Nothing left for the client to hold.
      await wait(cx, 300);
      try { await hc(["kill", "ddz-client"]); } catch {}
      if (shared(HOSTING)) {
        setShared(HOSTING, false);
        try { await hc(["kill", "ddz-server"]); } catch {}
      }
      return;
    }
    if (m.t === "_join") setShared(HOSTING, false);
    return this.send(cx, m);
  }
}
