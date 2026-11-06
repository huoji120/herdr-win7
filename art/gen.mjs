// Draws the art that needs math: the wavy four-pane flag, the wallpaper and
// the Start orb. Writes into ../mods/win7/. Run: node extensions/win7/art/gen.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "win7");
const f = (n) => Math.round(n * 100) / 100;

// A point of the flag: u across, v down, both 0..1, in a 200 x 180 box.
// The cloth waves (rising toward the right) and leans back a little.
function pt(u, v) {
  const wave = -16 * Math.sin(Math.PI * u) + 14 * u;
  const x = u * 200 + (1 - v) * 14 - 7 * Math.sin(Math.PI * v);
  const y = v * 172 + wave * (1 - 0.25 * v);
  return [x, y];
}

function pane(u0, u1, v0, v1) {
  const n = 14, pts = [];
  for (let i = 0; i <= n; i++) pts.push(pt(u0 + ((u1 - u0) * i) / n, v0));
  for (let i = 0; i <= n; i++) pts.push(pt(u1, v0 + ((v1 - v0) * i) / n));
  for (let i = n; i >= 0; i--) pts.push(pt(u0 + ((u1 - u0) * i) / n, v1));
  for (let i = n; i >= 0; i--) pts.push(pt(u0, v0 + ((v1 - v0) * i) / n));
  return "M" + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L") + "Z";
}

const PANES = [
  ["r", 0, 0.475, 0, 0.475, "#ff8a4c", "#e63b1c"],
  ["g", 0.525, 1, 0, 0.475, "#a6e04a", "#58a812"],
  ["b", 0, 0.475, 0.525, 1, "#4cc4ff", "#0b78d6"],
  ["y", 0.525, 1, 0.525, 1, "#ffd84a", "#f2a300"],
];

/** The flag's gradients (ids prefixed) and its panes, in a 200 x 180 box. */
function flag(id) {
  const defs = PANES.map(([k, , , , , a, b]) =>
    `<linearGradient id="${id}${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join("");
  const body = PANES.map(([k, u0, u1, v0, v1]) => `<path d="${pane(u0, u1, v0, v1)}" fill="url(#${id}${k})"/>`).join("");
  const shine = `<path d="${pane(0, 1, 0, 0.3)}" fill="#ffffff" opacity=".16"/>`;
  return { defs, body: body + shine };
}

// ---- wallpaper: blue sky with a bright core, light ribbons through it and the flag
{
  const W = 1920, H = 1080, fl = flag("w");
  const ribbon = (d, c, o, w) => `<path d="${d}" fill="none" stroke="${c}" stroke-opacity="${o}" stroke-width="${w}" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="sky" cx="0.5" cy="0.44" r="0.75"><stop offset="0" stop-color="#8fdcff"/><stop offset="0.22" stop-color="#3aa6ea"/><stop offset="0.55" stop-color="#1468bd"/><stop offset="1" stop-color="#05275c"/></radialGradient>
<radialGradient id="core"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset="0.3" stop-color="#d8f6ff" stop-opacity=".55"/><stop offset="1" stop-color="#9fe6ff" stop-opacity="0"/></radialGradient>
<linearGradient id="rib1" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7bf0c2" stop-opacity="0"/><stop offset=".45" stop-color="#b6ffe0" stop-opacity=".55"/><stop offset=".6" stop-color="#ffffff" stop-opacity=".6"/><stop offset="1" stop-color="#9ee7ff" stop-opacity="0"/></linearGradient>
<linearGradient id="rib2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe680" stop-opacity="0"/><stop offset=".5" stop-color="#fff2b0" stop-opacity=".45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>
<filter id="haze" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
${fl.defs}
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<ellipse cx="960" cy="470" rx="560" ry="420" fill="url(#core)"/>
<g filter="url(#soft)">
${ribbon("M-80 980 C 420 900 700 640 960 480 S 1500 120 2020 60", "url(#rib1)", 1, 90)}
${ribbon("M-60 760 C 380 760 700 560 960 470 S 1560 380 2000 520", "url(#rib2)", 1, 60)}
${ribbon("M200 1160 C 520 900 760 620 960 470 S 1300 160 1500 -60", "#c8fff0", 0.25, 70)}
</g>
<g filter="url(#haze)">
${ribbon("M-40 900 C 420 840 700 620 960 476 S 1520 150 1980 90", "#ffffff", 0.55, 4)}
${ribbon("M-20 820 C 400 800 720 590 960 472 S 1540 300 1960 380", "#e6fff6", 0.4, 3)}
${ribbon("M300 1120 C 560 880 780 640 960 478 S 1260 200 1420 -40", "#ffffff", 0.3, 3)}
${ribbon("M-60 1040 C 480 980 760 700 960 482 S 1600 200 2000 210", "#9ff2ff", 0.35, 2)}
</g>
<g fill="#ffffff">
<circle cx="1210" cy="330" r="3" opacity=".7"/><circle cx="1330" cy="250" r="2" opacity=".6"/><circle cx="700" cy="610" r="2.5" opacity=".6"/>
<circle cx="1480" cy="180" r="1.6" opacity=".7"/><circle cx="560" cy="700" r="1.8" opacity=".5"/><circle cx="1120" cy="390" r="1.4" opacity=".8"/>
</g>
<g transform="translate(820 345) scale(1.4)">
<g filter="url(#glow)" opacity=".9">${fl.body}</g>
${fl.body}
</g>
</svg>`;
  writeFileSync(join(out, "wallpaper.svg"), svg);
}

// ---- the Start orb, at rest and lit
for (const [name, hot] of [["orb", false], ["orb-hot", true]]) {
  const fl = flag("o");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<defs>
<radialGradient id="ball" cx="0.5" cy="0.85" r="0.85"><stop offset="0" stop-color="${hot ? "#6fe0ff" : "#2aa4e8"}"/><stop offset="0.35" stop-color="${hot ? "#1f8ee0" : "#11558f"}"/><stop offset="0.75" stop-color="${hot ? "#0b3c78" : "#082a4f"}"/><stop offset="1" stop-color="#03142a"/></radialGradient>
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f7ff" stop-opacity=".9"/><stop offset=".5" stop-color="#5a8fbf" stop-opacity=".6"/><stop offset="1" stop-color="#9fe2ff" stop-opacity=".95"/></linearGradient>
<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".75"/><stop offset="1" stop-color="#ffffff" stop-opacity=".04"/></linearGradient>
<radialGradient id="halo"><stop offset=".6" stop-color="#6fdcff" stop-opacity="${hot ? ".55" : ".0"}"/><stop offset="1" stop-color="#6fdcff" stop-opacity="0"/></radialGradient>
${fl.defs}
</defs>
<circle cx="32" cy="32" r="32" fill="url(#halo)"/>
<circle cx="32" cy="33" r="27" fill="#000" opacity=".35"/>
<circle cx="32" cy="32" r="26" fill="url(#ball)" stroke="url(#rim)" stroke-width="1.6"/>
<g transform="translate(18.5 19.5) scale(0.135)">${fl.body}</g>
<path d="M8.5 29 A 23.5 23.5 0 0 1 55.5 29 C 46 25 18 25 8.5 29 Z" fill="url(#gloss)"/>
</svg>`;
  writeFileSync(join(out, `${name}.svg`), svg);
}
console.log("art written to", out);
