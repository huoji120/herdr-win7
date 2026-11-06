// An "AI" plays a whole game through the MCP server: node extensions/win7/tests/mcp.mjs
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ddz = join(here, "../mods/win7/ddz");
const port = 18000 + Math.floor(Math.random() * 900);
const server = spawn(process.execPath, [join(ddz, "server.mjs"), String(port), "135790"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.once("data", r));
const mcp = spawn(process.execPath, [join(ddz, "mcp.mjs"), "--host", `127.0.0.1:${port}`, "--password", "135790", "--name", "测试AI"], { stdio: ["pipe", "pipe", "inherit"] });

let id = 0;
const pending = new Map();
readline.createInterface({ input: mcp.stdout }).on("line", (l) => { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id); });
const rpc = (method, params) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
const tool = async (name, args = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  const t = r.result?.content?.[0]?.text ?? "";
  try { return JSON.parse(t); } catch { return t; }
};
const fail = (m) => { console.error("FAIL:", m); cleanup(1); };
const cleanup = (code = 0) => { mcp.kill(); server.kill(); process.exit(code); };
setTimeout(() => fail("timed out"), 120000);

const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
if (init.result?.serverInfo?.name !== "herdr-ddz") fail("initialize");
const list = await rpc("tools/list", {});
console.log("tools:", list.result.tools.map((t) => t.name).join(" "));
const joined = await tool("ddz_join");
if (!joined.joined) fail(`join: ${JSON.stringify(joined)}`);
await tool("ddz_add_bot");
await tool("ddz_add_bot");
const started = await tool("ddz_start");
if (!started.ok) fail(`start: ${JSON.stringify(started)}`);
let turns = 0;
for (;;) {
  const w = await tool("ddz_wait", { timeout_seconds: 30 });
  const s = w.state;
  if (s.phase === "本局结束") { console.log(`over: ${s.message}, AI ${s.your_role}, change ${s.result.your_change}, after ${turns} AI turns`); break; }
  if (!s.your_turn) continue;
  turns++;
  let r;
  if (s.phase === "叫分") r = await tool("ddz_bid", { points: s.bid_top < 3 ? 3 : 0 });
  else if (s.suggestions?.length) r = await tool("ddz_play", { cards: s.suggestions[0].cards });
  else r = await tool("ddz_pass");
  if (!r.ok) fail(`action: ${JSON.stringify(r)}`);
}
console.log("mcp ok");
cleanup(0);
