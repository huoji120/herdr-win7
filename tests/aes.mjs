// The pure-JS AES matches node's: node extensions/win7/tests/aes.mjs
import crypto from "node:crypto";
import { ctr, cipher, toBase64, fromBase64, utf8, fromUtf8 } from "../mods/win7/ddz/aes.js";

const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };

// FIPS-197 C.3: AES-256 of 00112233..ff with key 000102..1f is 8ea2b7ca516745bfeafc49904b496089.
const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const block = Uint8Array.from({ length: 16 }, (_, i) => i * 0x11);
const zero = new Uint8Array(16);
// CTR with the plaintext as the counter and zero data gives E(plaintext).
assert(Buffer.from(ctr(key, block, zero)).toString("hex") === "8ea2b7ca516745bfeafc49904b496089", "FIPS-197 vector");

for (let n = 0; n < 200; n++) {
  const k = crypto.randomBytes(32), iv = crypto.randomBytes(16), data = crypto.randomBytes(n * 7);
  if (n === 3) iv.fill(0xff); // the counter wraps
  const mine = Buffer.from(ctr(k, iv, data));
  const c = crypto.createCipheriv("aes-256-ctr", k, iv);
  const theirs = Buffer.concat([c.update(data), c.final()]);
  assert(mine.equals(theirs), `ctr matches node (${n})`);
}

const sample = crypto.randomBytes(100);
assert(toBase64(sample) === sample.toString("base64"), "base64");
assert(Buffer.from(fromBase64(sample.toString("base64"))).equals(sample), "from base64");
const text = "斗地主 🂡 赖子 J♠ {\"t\":\"state\"}";
assert(Buffer.from(utf8(text)).equals(Buffer.from(text, "utf8")), "utf8");
assert(fromUtf8(Buffer.from(text, "utf8")) === text, "from utf8");

const a = cipher("123456", crypto), b = cipher("123456", crypto), wrong = cipher("654321", crypto);
const line = a.seal(text);
assert(b.open(line) === text, "round trip");
assert(wrong.open(line) === null, "wrong password is refused");
const tampered = line.slice(0, 30) + (line[30] === "A" ? "B" : "A") + line.slice(31);
assert(b.open(tampered) === null, "tampering is refused");
console.log("aes ok");
