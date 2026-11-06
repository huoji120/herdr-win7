// The desktop: icons down the left (click selects, double-click opens), the
// desktop menu on a right-click (刷新 blinks the icons and puts every window
// back in step), and the desktop's size for maximized windows and the menus
// over the taskbar.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { shared, setShared } from "herdr";
import { FONT, DESK, own, icon, shadowed, perform, openMenu } from "./kit.js";

const ICONS = [
  ["computer", "计算机", "computer", { explorer: null }],
  ["bin", "回收站", "recycle", null],
  ["ps", "Windows PowerShell", "ps", { run: ["tab.new", {}] }],
  ["cmd", "命令提示符", "cmd", { run: ["tab.new", { argv: ["cmd.exe"] }] }],
  ["control", "控制面板", "control", { run: ["app.settings", {}] }],
  ["ddz", "斗地主", "cards", { game: true }],
];

const MENU = [
  { label: "查看(V)", act: { run: ["app.settings", { section: "look" }] } },
  { label: "刷新(E)", act: { refresh: true } },
  { sep: true },
  { label: "新建终端(W)", act: { run: ["tab.new", {}] } },
  { label: "新建工作区(F)", act: { run: ["space.new", {}] } },
  { sep: true },
  { label: "屏幕分辨率(C)", act: { run: ["app.settings", { section: "look" }] } },
  { label: "个性化(R)", icon: "control", act: { run: ["app.settings", { section: "look" }] } },
];

export default class Desktop {
  init() {
    this.sel = null;
    this.hot = null;
    this.seen = shared("win7.refresh") ?? null;
    this.blink = false;
  }

  render(cx) {
    const stamp = shared("win7.refresh") ?? null;
    if (stamp !== this.seen) {
      this.seen = stamp;
      this.blink = true;
      this.sel = null;
      cx.timer.after(160, (cx) => { this.blink = false; cx.notify(); });
    }
    const cells = ICONS.map(([id, label, pic, act]) => {
      const sel = this.sel === id, hot = this.hot === id;
      return own(v_flex().id(`d-${id}`)).w(78).py(4).px(2).gap(3).items_center().rounded(3).flex_none()
        .border_1().border_color(sel ? "#99d1ffb0" : hot ? "#ffffff50" : "#00000000")
        .bg(sel ? "#66b4ff48" : hot ? "#ffffff1c" : "#00000000")
        .opacity(this.blink ? 0 : 1)
        .tooltip(act ? label : "回收站为空")
        .on_hover((on, cx) => { this.hot = on ? id : this.hot === id ? null : this.hot; cx.notify(); })
        .on_click((e, cx) => {
          cx.stop_propagation();
          this.sel = id;
          if (e.click_count >= 2 && act) { perform(act); this.sel = null; }
          cx.notify();
        })
        .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); this.sel = id; openMenu([{ label: "打开(O)", bold: true, act, disabled: !act }], e.position, { width: 150 }); cx.notify(); })
        .child(icon(pic, 48))
        .child(div().w_full().text_center().text_size(12).line_height("15px").child(shadowed(label)));
    });
    return v_flex().id("desktop").size_full().pt(6).pl(4).gap(10).font_family(FONT)
      .flex_wrap()
      .on_size_change((size) => {
        const d = shared(DESK);
        if (!d || Math.abs(d.w - size.width) > 0.5 || Math.abs(d.h - size.height) > 0.5) setShared(DESK, { w: size.width, h: size.height });
      })
      .on_click((_e, cx) => { this.sel = null; cx.notify(); })
      .on_mouse_down("right", (e, cx) => { this.sel = null; openMenu(MENU, e.position, { width: 190 }); cx.notify(); })
      .children(cells);
  }
}
