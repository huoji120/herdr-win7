// A window's title bar: program icon and title on the glass, the caption
// buttons hanging from the top edge (red close on the window in front).
// Drag it to move the window, double-click to maximize, right-click for the
// window menu. `edge` is the frame's bottom strip: glass only.

import { div, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props } from "herdr";
import {
  FONT, CAPTION, EDGE, icon, glossy, own, frost, windowSpot, windowSize, originOf, programIcon, terms, title, active, records,
  focusWindow, minimizeWindow, toggleMax, confirmClose, openMenu,
} from "./kit.js";

// The window glass's tint over the frosted wallpaper: in front, and behind.
export const GLASS = ["#d9ebfa7a", "#a3c4e890"];
export const GLASS_DIM = ["#e6f0f9a8", "#c9d9eab4"];

// [top, middle, lower, bottom] of each caption button face.
const FACE = {
  idle: ["#f4f8fce0", "#d5e3f0c8", "#9fbad6c0", "#c2d7ebd8"],
  hot: ["#e4f6ffee", "#a6dcfbee", "#3fb0f3f0", "#8fe3fff0"],
  down: ["#b9d9f0f0", "#7fb6dcf0", "#2a7fbff0", "#4ca9e4f0"],
  close: ["#eab3a5f4", "#d88472f4", "#c4472cf4", "#d9806af4"],
  closeHot: ["#fcc2b1f8", "#f0907af8", "#e54c22f8", "#f8a57af8"],
  closeDown: ["#d79a8cf8", "#c4614ef8", "#a22d12f8", "#b85a40f8"],
  dim: ["#ffffff58", "#ffffff28", "#ffffff0a", "#ffffff30"],
};

function streaks() {
  const band = (x0, w, o) => window.paint_path(
    PathBuilder.fill().move_to(`${x0}%`, "0%").line_to(`${x0 + w}%`, "0%").line_to(`${x0 + w - 5}%`, "100%").line_to(`${x0 - 5}%`, "100%").close().build(),
    Background.linear_gradient(180, `#ffffff${o}`, "#ffffff00"),
  ).absolute().top(0).left(0).size_full();
  return div().absolute().top(0).left(0).size_full().child(band(18, 7, "30")).child(band(29, 3, "26")).child(band(62, 9, "22"));
}

/**
 * The caption buttons hanging from a window's top edge. `host` keeps which one
 * is hovered and pressed (its hot and down). o: { id, max, front, onMin, onMax, onClose }.
 */
export function captions(host, o) {
  const h = o.max ? 19 : 20;
  const button = (kind, w, onClick) => {
    const close = kind === "close";
    const hot = host.hot === kind, down = host.down === kind;
    let face;
    if (close) face = down ? FACE.closeDown : hot ? FACE.closeHot : o.front ? FACE.close : FACE.dim;
    else face = down ? FACE.down : hot ? FACE.hot : o.front ? FACE.idle : FACE.dim;
    const glyph = close ? icon("ctl-close", 16, 13) : icon(kind === "restore" ? "ctl-restore" : `ctl-${kind}`, 14, 12);
    return own(div().id(`${o.id}-${kind}`)).relative().w(w).h(h - 1).flex_none().cursor_pointer()
      .when(!close, (el) => el.border_r(1).border_color("#24364ec0"))
      .on_hover((on, cx) => { host.hot = on ? kind : host.hot === kind ? null : host.hot; if (!on) host.down = null; cx.notify(); })
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); host.down = kind; cx.notify(); })
      .on_mouse_up("left", (_e, cx) => { host.down = null; cx.notify(); })
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); cx.notify(); })
      .child(glossy(...face))
      .child(div().absolute().top(0).left(0).size_full().border_1().border_color(hot || (close && o.front) ? "#ffffff90" : "#ffffff50")
        .when(close, (el) => el.rounded_br(3)).when(kind === "min", (el) => el.rounded_bl(3)))
      .child(div().relative().size_full().flex().items_center().justify_center().child(glyph));
  };
  return h_flex().absolute().top(0).right(o.max ? 2 : 0).h(h).flex_none()
    .border_1().border_t(0).border_color("#1c2c42d8").rounded_b(4).overflow_hidden()
    .child(button("min", 27, o.onMin))
    .child(button(o.max ? "restore" : "max", 27, o.onMax))
    .child(button("close", 47, o.onClose));
}

export default class TitleBar {
  init() {
    this.hot = null;
    this.down = null;
  }

  render(_cx) {
    const p = props() ?? {};
    const t = p.terminal;
    const pane = terms().find((x) => x.terminal === t);
    const max = Boolean(p.max ?? records()[t]?.max);
    const front = active() === t;
    const menu = (at) => openMenu([
      { label: "还原(R)", act: { max: t }, disabled: !max },
      { label: "最小化(N)", act: { min: t } },
      { label: "最大化(X)", act: { max: t }, disabled: max },
      { sep: true },
      { label: "关闭(C)", bold: true, hint: "Alt+F4", act: { close: [t] } },
    ], at, { width: 190 });
    const caps = captions(this, { id: `cap-${t}`, max, front, onMin: () => minimizeWindow(t), onMax: () => toggleMax(t), onClose: () => confirmClose([t]) });
    const label = div().px(6).py(1).rounded(9).bg(front ? "#ffffff42" : "#ffffff22")
      .text_size(12).text_color(front ? "#000000" : "#2e3a46").truncate().child(title(pane) || "命令提示符");
    // The glass: live from the pointer while it moves over the bar (a drag), else from the remembered spot.
    const spot = windowSpot(t, max);
    const key = spot ? `${spot.x},${spot.y}` : "";
    if (key !== this.spotKey) { this.spotKey = key; this.live = null; }
    const at = this.live ?? (spot ? { x: spot.x + 1, y: spot.y + 1 } : null);
    return h_flex().id(`cap-${t}`).relative().size_full().items_center().pl(max ? 6 : 8).pr(110)
      .when(!max, (el) => el.rounded_t(6)).overflow_hidden()
      .font_family(FONT)
      .on_mouse_move((e, cx) => {
        const o = originOf(e);
        if (o && (!this.live || Math.abs(o.x - this.live.x) + Math.abs(o.y - this.live.y) > 0.5)) { this.live = o; cx.notify(); }
      })
      .on_click((e, cx) => {
        if (e.click_count >= 2) toggleMax(t);
        else focusWindow(t);
        cx.notify();
      })
      .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); menu(e.position); })
      .child(frost(at, front ? GLASS : GLASS_DIM))
      .child(streaks())
      .when(!max, (el) => el.child(div().absolute().top(0).left(0).right(0).h(1).bg("#ffffffa8"))
        .child(div().absolute().top(0).left(0).bottom(0).w(1).bg("#ffffff80"))
        .child(div().absolute().top(0).right(0).bottom(0).w(1).bg("#ffffff80")))
      .child(h_flex().relative().min_w(0).items_center().gap(5).mt(max ? 0 : 1)
        .child(pane ? programIcon(pane.program, 16) : icon("cmd", 16))
        .child(div().min_w(0).child(label)))
      .child(caps);
  }
}

/** A side or the bottom of a window's frame: glass, its outer highlight, the bottom corners. */
export class Edge {
  init() {
    this.live = null;
  }

  render() {
    const p = props() ?? {};
    const spot = windowSpot(p.terminal, p.max);
    const size = windowSize(p.max);
    const key = spot ? `${spot.x},${spot.y}` : "";
    if (key !== this.spotKey) { this.spotKey = key; this.live = null; }
    let at = null;
    if (spot && size) {
      if (p.side === "l") at = { x: spot.x + 1, y: spot.y + 1 + CAPTION };
      if (p.side === "r") at = { x: spot.x + size.w - 1 - EDGE, y: spot.y + 1 + CAPTION };
      if (p.side === "b") at = { x: spot.x + 1, y: spot.y + size.h - 1 - EDGE };
    }
    const front = active() === p.terminal;
    const hi = (el) => p.side === "l" ? el.top(0).left(0).bottom(0).w(1)
      : p.side === "r" ? el.top(0).right(0).bottom(0).w(1) : el.bottom(0).left(0).right(0).h(1);
    return div().id(`edge-${p.side}`).relative().size_full().overflow_hidden()
      .when(p.side === "b", (el) => el.rounded_b(6))
      .on_mouse_move((e, cx) => {
        const o = originOf(e);
        if (o && (!this.live || Math.abs(o.x - this.live.x) + Math.abs(o.y - this.live.y) > 0.5)) { this.live = o; cx.notify(); }
      })
      .child(frost(this.live ?? at, front ? GLASS : GLASS_DIM))
      .child(hi(div().absolute()).bg("#ffffff80"))
      .when(p.side === "b", (el) => el
        .child(div().absolute().top(0).bottom(0).left(0).w(1).bg("#ffffff80"))
        .child(div().absolute().top(0).bottom(0).right(0).w(1).bg("#ffffff80")));
  }
}
