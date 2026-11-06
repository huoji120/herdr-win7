// Herdr 7's drawing kit and window manager, shared by every role.
//
// Every terminal pane is a Win7 window: a keyed overlay holding a layout
// (glass frame, this mod's title bar, the live terminal). Which windows are
// open, minimized or maximized lives in shared "win7.windows", so the
// taskbar, the Start menu and the title bars agree.

import { div, image, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, spaces, focused, shared, setShared, openOverlay, closeOverlay, run, settings } from "herdr";

export const A = "mods/win7";
export const FONT = "Microsoft YaHei UI";
export const STATE = "win7.windows";
export const DESK = "win7.desk";
export const TASKBAR = 40;

export const zoom = () => Number(settings()?.zoom) || 1;
export const asset = (name) => `${A}/icons/${name}.svg`;
export const icon = (name, w, h = w) => image(asset(name)).w(w).h(h).flex_none();
export const glyph = (name, w, h = w) => svg(asset(name)).w(w).h(h).flex_none();

// ---- paint

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A layer filling its (relative) parent with a gradient; 180 runs top to bottom. */
export function fill(from, to, angle = 180) {
  return window.paint_path(RECT(), Background.linear_gradient(angle, from, to)).absolute().top(0).left(0).size_full();
}

// ---- glass
//
// There is no blur of what's behind an overlay, but the wallpaper is fixed:
// glass draws its slice of a pre-blurred copy (wallpaper-blur.png, rendered
// from art/blur.html), placed where the layout's "cover" puts the wallpaper, so it
// reads as frosted glass over the desktop. Windows aren't blurred through it.

export const PLACES = "win7.places";

/** Where the layout's cover-fitted wallpaper sits: { x, y, w, h }, or null before the desktop has a size. */
function wallpaperBox() {
  const d = shared(DESK);
  if (!d) return null;
  const W = d.w, H = d.h + TASKBAR;
  const s = Math.max(W / 1920, H / 1080);
  return { x: (W - 1920 * s) / 2, y: (H - 1080 * s) / 2, w: 1920 * s, h: 1080 * s };
}

/**
 * A glass layer for an element whose top left is at `at` in the window:
 * the blurred wallpaper behind it, then the tint. Fills its parent (relative,
 * overflow hidden). Without a known spot, the tint alone.
 */
export function frost(at, tint = ["#cfe3f6a8", "#a6c6e8b0"]) {
  const box = wallpaperBox();
  const layer = div().absolute().top(0).left(0).size_full();
  if (at && box) layer.child(image(`${A}/wallpaper-blur.png`).absolute().left(box.x - at.x).top(box.y - at.y).w(box.w).h(box.h));
  return layer.child(fill(tint[0], tint[1]));
}

/** A window's top left in the app window: maximized at 0,0, else its remembered spot. */
export function windowSpot(t, max) {
  if (max) return { x: 0, y: 0 };
  // Herdr keeps where a window was dropped; before its first drop, where it opened.
  const p = shared(PLACES)?.[`win7:${t}`];
  if (p) return { x: p[0], y: p[1] };
  return (t === "explorer" ? shared(EXPLORER)?.at : records()[t]?.at) ?? null;
}

/** A window's size, as its overlay share of the app window. */
export function windowSize(max) {
  const d = shared(DESK);
  if (!d) return null;
  return max ? { w: d.w, h: d.h } : { w: Math.floor(d.w * 0.6), h: Math.floor((d.h + TASKBAR) * 0.62) };
}

/** An element's top left in the window, from a pointer event over it. */
export function originOf(e) {
  if (!e?.position || !e?.local_position) return null;
  return { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y };
}

/** The Win7 glass button face: a bright upper half over a deeper lower half. */
export function glossy(top, mid, low, bottom) {
  return div().absolute().top(0).left(0).size_full().flex().flex_col()
    .child(div().relative().flex_1().child(fill(top, mid)))
    .child(div().relative().flex_1().child(fill(low, bottom)));
}

/** A press on a control is the control's: not a window or overlay drag. */
export function own(el) {
  return el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
}

/** Text with a soft dark shadow (desktop icon labels, the clock). */
export function shadowed(text, color = "#ffffff", shadow = "#000000b0") {
  return div().relative()
    .child(div().absolute().top(1).left(1).w_full().text_color(shadow).child(text))
    .child(div().relative().text_color(color).child(text));
}

// ---- programs

/** A program's icon in full color. Shells get the PowerShell or Command Prompt icon. */
export function programIcon(prog, size) {
  if (!prog || prog.shell || !prog.icon || prog.key === "program") {
    const cmd = /(^|\W)cmd(\.exe)?$/i.test(prog?.name ?? "");
    return icon(prog?.shell && !cmd ? "ps" : "cmd", size);
  }
  if (!prog.tint) return image(prog.icon).w(size).h(size).flex_none();
  const g = Math.round(size * 0.66);
  return div().relative().w(size).h(size).flex_none().rounded(Math.round(size * 0.22)).overflow_hidden()
    .bg(prog.tile ?? "#2f6eb0").flex().items_center().justify_center()
    .child(div().absolute().top(0).left(0).w_full().h(size / 2).bg("#ffffff2a"))
    .child(svg(prog.icon).w(g).h(g).text_color(prog.color ?? "#ffffff"));
}

// ---- windows

// Claude Code started from a shell on Windows reports nothing (no OSC 7501)
// and herdr-core sees only the shell, but its title gives it away: "✳ topic"
// while it waits, a braille spinner ("⠂ topic") while it works. Herdr shows
// titles without that mark, so the taskbar reads it from herdr-core
// (`hc get`) into shared CLAUDE_SEEN: { terminal: "working" | "idle" }.
export const CLAUDE_SEEN = "win7.claude";
const CLAUDE = { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, tile: "#1c1d21", color: "#ffffff", shell: false, agent: true };

/** "working" or "idle" when a raw terminal title is Claude Code's, else null. */
export function claudeTitle(raw) {
  const c = String(raw ?? "").trim().codePointAt(0) ?? 0;
  if (c >= 0x2801 && c <= 0x28ff) return "working";
  return c === 0x2733 ? "idle" : null;
}

function recognize(p, seen) {
  const s = seen[p.terminal];
  if (!s || p.status || p.program?.agent) return p;
  return { ...p, program: CLAUDE, status: s, title: (p.title ?? "").replace(/^[⠁-⣿✳]\s*/u, "").trim(), guessed: true };
}

/** Every terminal pane (the windows), Claude Code recognized by its title. */
export function terms() {
  const seen = shared(CLAUDE_SEEN) ?? {};
  return panes().filter((p) => p.terminal).map((p) => recognize(p, seen));
}

export const records = () => shared(STATE) ?? {};
const save = (all) => setShared(STATE, all);
/**
 * The window in front: the one raised last (a title bar or taskbar click,
 * Explorer), while the keyboard hasn't moved since; else the terminal with
 * the keyboard. A terminal id, or "explorer".
 */
export function active() {
  const f = shared("win7.front");
  const kb = focused()?.terminal ?? null;
  if (f?.t && f.kb === kb) return f.t;
  return kb ?? f?.t ?? null;
}

/** Marks a window as in front. `kb`: the terminal that will have the keyboard. */
export function raise(t, kb = focused()?.terminal ?? null) {
  const f = shared("win7.front");
  if (f?.t !== t || f?.kb !== kb) setShared("win7.front", { t, kb });
}

export function focusWindow(t) {
  raise(t, t);
  run("pane.focus", { terminal: t });
}

export function tabOf(p) {
  return spaces().flatMap((s) => s.tabs).find((t) => t.id === p.tab);
}

export function spaceOf(p) {
  return spaces().find((s) => s.tabs.some((t) => t.id === p.tab));
}

/** What a window's title bar and taskbar entry say. */
export function title(p) {
  if (!p) return "";
  const tab = tabOf(p);
  if (tab?.named) return tab.name;
  const t = (p.title ?? "").trim();
  if (t) return t;
  return p.program?.shell ? "Windows PowerShell" : p.program?.name || "命令提示符";
}

export const CAPTION = 30, CAPTION_MAX = 23, EDGE = 7;

/**
 * The overlay layout of a window: a dark rim around glass that is all this
 * mod (the title bar and three edges, each drawing its slice of frosted
 * wallpaper), and the terminal in the middle.
 */
function frame(t, max) {
  const glass = (role, px, side) => ({ id: `w7-${t}-${side ?? role}`, type: "block", size: { px }, content: { mod: "win7", props: { role, terminal: t, max, side } } });
  const term = { id: `w7-${t}-term`, type: "block", content: { terminal: t }, background: "#000000", border: { width: 1, color: max ? "#3d5574" : "#4f6d8e" } };
  const children = max ? [glass("title", CAPTION_MAX), term] : [
    glass("title", CAPTION),
    { id: `w7-${t}-mid`, type: "row", resizable: false, children: [glass("edge", EDGE, "l"), term, glass("edge", EDGE, "r")] },
    glass("edge", EDGE, "b"),
  ];
  return {
    id: `w7-${t}`, type: "column", radius: max ? 0 : 7,
    border: { width: 1, color: "#0c1726d8" }, ...(max ? {} : { shadow: "lg" }),
    background: { gradient: ["#c6ddf3f4", "#a3c3e5f0"], angle: 180 },
    children,
  };
}

function spec(t, max, slot) {
  const z = zoom();
  const desk = shared(DESK);
  if (max) return { kind: "window", frame: "none", width: desk ? desk.w / z : 1, height: desk ? desk.h / z : 0.95, at: { x: 0, y: 0 }, layout: frame(t, true) };
  const n = slot % 8;
  return { kind: "window", frame: "none", key: `win7:${t}`, width: 0.6, height: 0.62, at: { x: 150 + n * 30, y: 30 + n * 28 }, layout: frame(t, false) };
}

function nextSlot(all) {
  const used = new Set(Object.values(all).map((r) => r?.slot));
  let n = 0;
  while (used.has(n)) n++;
  return n;
}

/** Opens (or raises, in place) the window of a terminal. o: { max, focus }. */
export function showWindow(t, o = {}) {
  const all = records();
  const rec = all[t] ?? { slot: nextSlot(all) };
  const max = o.max ?? rec.max ?? false;
  if (rec.id && (rec.max || max !== Boolean(rec.max))) closeOverlay(rec.id);
  const s = spec(t, max, rec.slot ?? 0);
  const id = openOverlay(s);
  save({ ...records(), [t]: { ...rec, id, open: true, max, at: max ? rec.at : s.at } });
  if (o.focus !== false) focusWindow(t);
}

export function minimizeWindow(t) {
  const all = records();
  const rec = all[t];
  if (!rec) return;
  if (rec.id) closeOverlay(rec.id);
  save({ ...all, [t]: { ...rec, id: null, open: false } });
}

export function toggleMax(t) {
  showWindow(t, { max: !records()[t]?.max });
}

/** Taskbar click on one window: raise it, or minimize it when it's already in front. */
export function toggleWindow(t) {
  const rec = records()[t];
  if (rec?.open && active() === t) minimizeWindow(t);
  else showWindow(t);
}

/**
 * Keeps windows in step with the terminals: a window for every new terminal,
 * none for ended ones. `reopen`: also reopen every open window (the layout was
 * just shown, or this mod reloaded: overlays from before are gone or stale).
 */
export function syncWindows(reopen = false) {
  const live = terms();
  const all = { ...records() };
  let changed = false;
  for (const t of Object.keys(all)) {
    if (!live.some((p) => p.terminal === t)) {
      if (all[t]?.id) closeOverlay(all[t].id);
      delete all[t];
      changed = true;
    }
  }
  for (const p of live) {
    const t = p.terminal;
    // A record from an earlier build ({ id, status, maximized }) is open unless hidden.
    if (all[t] && all[t].open === undefined) {
      all[t] = { slot: nextSlot(all), max: Boolean(all[t].maximized), open: all[t].status === "open", id: all[t].id ?? null };
      changed = true;
    }
    const rec = all[t];
    if (rec && !(reopen && rec.open)) continue;
    const slot = rec?.slot ?? nextSlot(all);
    const max = rec?.max ?? false;
    if (rec?.id && max) closeOverlay(rec.id);
    const s = spec(t, max, slot);
    all[t] = { slot, max, open: true, id: openOverlay(s), at: max ? rec?.at : s.at };
    changed = true;
  }
  if (changed) save(all);
  return live;
}

// ---- the Explorer window ("计算机"): spaces as drives, their terminals as folders

export const EXPLORER = "win7.explorer";
export const EXPLORER_W = 820, EXPLORER_H = 540;

/** Opens (or raises) Explorer. `at`: a space id to show, null for 计算机, undefined to stay where it was. */
export function openExplorer(at, o = {}) {
  const rec = shared(EXPLORER) ?? {};
  const z = zoom();
  const max = o.max ?? rec.max ?? false;
  const d = shared(DESK);
  if (rec.id && (rec.max || max)) closeOverlay(rec.id);
  const id = openOverlay(max
    ? { mod: "win7", kind: "window", frame: "none", width: d ? d.w / z : 1, height: d ? d.h / z : 0.95, at: { x: 0, y: 0 }, props: { role: "explorer", max: true } }
    : { mod: "win7", kind: "window", frame: "none", key: "win7:explorer", width: EXPLORER_W / z, height: EXPLORER_H / z, at: { x: 260, y: 70 }, props: { role: "explorer" } });
  setShared(EXPLORER, { ...rec, id, open: true, max, at: { x: 260, y: 70 }, space: at === undefined ? rec.space ?? null : at });
  raise("explorer");
}

export function minimizeExplorer() {
  const rec = shared(EXPLORER);
  if (rec?.id) closeOverlay(rec.id);
  if (rec) setShared(EXPLORER, { ...rec, id: null, open: false });
}

export function closeExplorer() {
  const rec = shared(EXPLORER);
  if (rec?.id) closeOverlay(rec.id);
  setShared(EXPLORER, null);
}

// ---- actions in props (menus and lists carry these, not functions)

/**
 * Does what an item says: { run: [command, args] }, { show | min | max: terminal },
 * { close: [terminals] }, { explorer: space id | null }, { refresh: true }, { restoreAll: true }.
 */
export function perform(act) {
  if (!act) return;
  if (act.run) run(act.run[0], act.run[1] ?? {});
  if (act.explorer !== undefined) openExplorer(act.explorer);
  if (act.closeExplorer) closeExplorer();
  if (act.refresh) {
    setShared("win7.refresh", Date.now());
    syncWindows(true);
    if (shared(EXPLORER)?.open) openExplorer();
  }
  if (act.show) showWindow(act.show);
  if (act.min) minimizeWindow(act.min);
  if (act.max) toggleMax(act.max);
  if (act.restoreAll) for (const p of terms()) showWindow(p.terminal, { focus: false });  if (act.close) confirmClose(act.close);
}

/** Asks before ending terminals, as Windows asks before closing a program. */
export function confirmClose(list) {
  const ts = [].concat(list);
  openOverlay({ mod: "win7", kind: "dialog", frame: "none", modal: true, width: 400 / zoom(), height: 178 / zoom(), props: { role: "dialog", terminals: ts } });
}

/**
 * Menus, the Start menu and thumbnails. Popups draw under windows, so these
 * are frameless windows (unkeyed: always at `at`) that close on a press
 * outside them (`transient`). w, h: px at zoom 1.
 */
export function openPopup(role, w, h, at, p = {}) {
  const z = zoom();
  return openOverlay({ mod: "win7", kind: "window", frame: "none", width: w / z, height: h / z, at: at ?? { x: 200, y: 200 }, props: { role, ...p } });
}

/** The root of a transient overlay: not draggable, closed by a press elsewhere. */
export function transient(el, overlay) {
  return el.id("transient")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_down_out((_e, cx) => { closeOverlay(overlay); cx.notify(); });
}

/** A Win7 context menu: items [{ label, act, bold, disabled, icon, hint } | { sep: true }]. */
export function openMenu(items, at, o = {}) {
  const h = items.reduce((n, it) => n + (it.sep ? 7 : 24), 6);
  const w = o.width ?? 210;
  const where = at?.above ? { x: at.above.x, y: Math.max(0, at.above.y - h) } : at;
  return openPopup("menu", w, h, where, { items });
}

export function row() {
  return h_flex().items_center();
}
