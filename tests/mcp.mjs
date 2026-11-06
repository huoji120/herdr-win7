// An AI plays *your* seat through the MCP server, the way it does from
// Claude Code: the client (your game window's link) is at the table, the MCP
// server drives it over its control port, and the state file (what your
// window shows) follows every move. node extensions/win7/tests/mcp.mjs
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ddz = join(here, "../mods/win7/ddz");
const port = 18000 + Math.floor(Math.random() * 900);
const file = join(mkdtempSync(join(tmpdir(), "ddz-")), "state.json");
const server = spawn(process.execPath, [join(ddz, "server.mjs"), String(port), "135790"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.once("data", r));
const client = spawn(process.execPath, [join(ddz, "client.mjs"), file, "主人"], { stdio: ["pipe", "pipe", "inherit"] });
await new Promise((r) => client.stdout.once("data", r));
client.stdin.write(JSON.stringify({ t: "_join", addr: `127.0.0.1:${port}`, password: "135790", tries: 3 }) + "\n");
const read = () => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } };
for (let k = 0; k < 50 && read().status !== "online"; k++) await new Promise((r) => setTimeout(r, 100));

const mcp = spawn(process.execPath, [join(ddz, "mcp.mjs"), "--state", file], { stdio: ["pipe", "pipe", "inherit"] });
let id = 0;
const pending = new Map();
readline.createInterface({ input: mcp.stdout }).on("line", (l) => { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id); });
const rpc = (method, params) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
const tool = async (name, args = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  const t = r.result?.content?.[0]?.text ?? "";
  try { return JSON.parse(t); } catch { return t; }
};
const cleanup = (code = 0) => { mcp.kill(); client.kill(); server.kill(); process.exit(code); };
const fail = (m) => { console.error("FAIL:", m); cleanup(1); };
setTimeout(() => fail("timed out"), 150000);

const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
if (init.result?.serverInfo?.name !== "herdr-ddz") fail("initialize");
const list = await rpc("tools/list", {});
console.log("tools:", list.result.tools.map((t) => t.name).join(" "));
const first = await tool("ddz_state");
if (first.connection !== "online" || first.you !== 0) fail(`the AI sits in your seat: ${JSON.stringify(first).slice(0, 300)}`);
for (let k = 0; k < 30 && !(read().ai && read().state?.seats?.[0]?.ai); k++) await new Promise((r) => setTimeout(r, 100));
if (!read().ai || !read().state.seats[0].ai) fail("your window and the table show the seat as AI-played");
await tool("ddz_add_bot");
await tool("ddz_add_bot");
const started = await tool("ddz_start");
if (!started.ok) fail(`start: ${JSON.stringify(started)}`);
let turns = 0, doubled = false;
for (;;) {
  const w = await tool("ddz_wait", { timeout_seconds: 30 });
  const s = w.state;
  if (s.phase === "本局结束") {
    console.log(`over: ${s.message}; the AI was ${s.your_role}, ${doubled ? "超级加倍" : "no 加倍 turn"}, change ${s.result.your_change}, after ${turns} turns`);
    break;
  }
  if (!s.your_turn) continue;
  turns++;
  let r;
  if (s.phase === "叫分") r = await tool("ddz_bid", { points: s.bid_top < 3 ? 3 : 0 });
  else if (s.phase === "加倍") { r = await tool("ddz_double", { times: 4 }); doubled = true; }
  else if (s.suggestions?.length) r = await tool("ddz_play", { cards: s.suggestions[0].cards });
  else r = await tool("ddz_pass");
  if (!r.ok) fail(`action: ${JSON.stringify(r).slice(0, 400)}`);
}
for (let k = 0; k < 20 && read().state?.phase !== "over"; k++) await new Promise((r) => setTimeout(r, 50));
const v = read();
if (v.state.phase !== "over" || v.state.doubles[0] !== 4) fail(`the state file (your window) shows the finished game and the 超级加倍: ${v.state.phase} ${JSON.stringify(v.state.doubles)} ${JSON.stringify(v.state.result)}`);
mcp.kill();
for (let k = 0; k < 30 && read().ai; k++) await new Promise((r) => setTimeout(r, 100));
if (read().ai) fail("the seat goes back to you when the AI disconnects");
console.log("mcp ok");
cleanup(0);
