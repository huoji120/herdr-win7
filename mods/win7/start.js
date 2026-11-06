// The Start menu: programs on the white pane (shells, OMP and Pi pinned, installed agents
// below; All Programs lists every space as a folder of its windows), the
// search box (the command palette), places and settings on the glass, the
// picture that changes with the hovered place, and Shut down with its menu.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, home, knownAgents, spaces, shared, setShared, closeOverlay } from "herdr";
import { FONT, DESK, fill, frost, transient, own, icon, glyph, programIcon, terms, title, showWindow, perform, openMenu, asset } from "./kit.js";

const LEFT_W = 252, START_H = 532;

// Pinned agents, shown whether or not the program table finds them installed.
const PINNED = [
  { key: "omp", name: "OMP", icon: "icons/agent.svg", tint: true, tile: "#1c1d21", color: "#ffffff", run: ["omp"] },
  { key: "pi", name: "Pi", icon: "icons/pi.svg", tint: true, tile: "#1c1d21", color: "#ffffff", run: ["pi"] },
];

function folder(...parts) {
  const h = home() ?? "";
  const sep = h.includes("\\") ? "\\" : "/";
  return [h.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

function userName() {
  return (home() ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "User";
}

export default class StartMenu {
  init(_p, cx) {
    this.hot = null;
    this.all = false;
    this.open = {};
    this.agents = [];
    cx.spawn(async (cx) => {
      try { this.agents = (await knownAgents()).filter((a) => a.installed); } catch {}
      cx.notify();
    });
  }

  close() {
    setShared("win7.start", { closed: Date.now() });
  }

  done(act) {
    closeOverlay(props()?.overlay);
    setShared("win7.start", { closed: Date.now() });
    perform(act);
  }

  hover(id) {
    return (on, cx) => { this.hot = on ? id : this.hot === id ? null : this.hot; cx.notify(); };
  }

  // ---- the white pane

  program(id, pic, label, act) {
    const hot = this.hot === id;
    return own(h_flex().id(id)).relative().h(40).mx(4).px(4).gap(8).flex_none().items_center().rounded(3).cursor_pointer()
      .border_1().border_color(hot ? "#7da2ce" : "#00000000")
      .on_hover(this.hover(id))
      .on_click((_e, cx) => { this.done(act); cx.notify(); })
      .when(hot, (el) => el.child(div().absolute().top(0).left(0).size_full().rounded(2).overflow_hidden().child(fill("#eef5fd", "#c6ddf7"))))
      .child(div().relative().child(pic))
      .child(div().relative().flex_1().min_w(0).truncate().text_color("#000000").child(label));
  }

  entry(id, pic, label, onClick, indent = 0) {
    const hot = this.hot === id;
    return own(h_flex().id(id)).relative().h(24).mx(4).pl(6 + indent).pr(4).gap(6).flex_none().items_center().rounded(3).cursor_pointer()
      .border_1().border_color(hot ? "#7da2ce" : "#00000000")
      .on_hover(this.hover(id))
      .on_click((_e, cx) => { onClick(); cx.notify(); })
      .when(hot, (el) => el.child(div().absolute().top(0).left(0).size_full().rounded(2).overflow_hidden().child(fill("#eef5fd", "#c6ddf7"))))
      .child(div().relative().child(pic))
      .child(div().relative().flex_1().min_w(0).truncate().text_color("#000000").child(label));
  }

  programs() {
    const list = v_flex().flex_1().min_h(0).pt(6).gap(0)
      .child(this.program("p-ps", icon("ps", 32), "Windows PowerShell", { run: ["tab.new", {}] }))
      .child(this.program("p-cmd", icon("cmd", 32), "命令提示符", { run: ["tab.new", { argv: ["cmd.exe"] }] }));
    for (const a of PINNED) list.child(this.program(`p-${a.key}`, programIcon(a, 32), a.name, { run: ["tab.new", { argv: a.run }] }));
    const more = this.agents.filter((a) => !PINNED.some((x) => x.key === a.key)).slice(0, 5);
    if (more.length) {
      list.child(div().h(1).mx(10).my(4).bg("#d6e5f5"));
      for (const a of more) list.child(this.program(`p-${a.key}`, programIcon(a, 32), a.name, { run: ["tab.new", { argv: a.run }] }));
    }
    return list;
  }

  allPrograms() {
    const live = terms();
    const list = v_flex().id("all").flex_1().min_h(0).pt(6).overflow_y_scroll();
    for (const s of spaces()) {
      const open = this.open[s.id] ?? s.active;
      list.child(this.entry(`s-${s.id}`, icon("folder", 16), s.name, () => { this.open[s.id] = !open; }));
      if (!open) continue;
      for (const t of s.tabs) for (const p of live.filter((x) => x.tab === t.id)) {
        list.child(this.entry(`w-${p.terminal}`, programIcon(p.program, 16), title(p), () => this.done({ show: p.terminal }), 16));
      }
      list.child(this.entry(`n-${s.id}`, icon("ps", 16), "新建窗口", () => this.done({ run: ["tab.new", { space: s.id }] }), 16));
    }
    list.child(this.entry("new-space", icon("folder", 16), "新建工作区...", () => this.done({ run: ["space.new", {}] })));
    return list;
  }

  pane() {
    const hot = this.hot === "toggle-all";
    const toggle = own(h_flex().id("toggle-all")).relative().h(30).mx(4).mb(4).px(8).gap(8).flex_none().items_center().rounded(3).cursor_pointer()
      .border_1().border_color(hot ? "#7da2ce" : "#00000000")
      .on_hover(this.hover("toggle-all"))
      .on_click((_e, cx) => { this.all = !this.all; this.hot = null; cx.notify(); })
      .when(hot, (el) => el.child(div().absolute().top(0).left(0).size_full().rounded(2).overflow_hidden().child(fill("#eef5fd", "#c6ddf7"))))
      .child(div().relative().w(16).flex().justify_center().text_color("#1e395b")
        .child(this.all ? div().text_size(9).child("◀") : glyph("arrow", 8, 10)))
      .child(div().relative().text_color("#000000").child(this.all ? "返回" : "所有程序"));
    return v_flex().w(LEFT_W).flex_1().min_h(0).bg("#ffffff").rounded(3).border_1().border_color("#7f98b5")
      .child(this.all ? this.allPrograms() : this.programs())
      .child(div().h(1).mx(10).mb(2).bg("#d6e5f5"))
      .child(toggle);
  }

  search() {
    return own(h_flex().id("search")).w(LEFT_W).h(26).mt(8).mb(2).pl(8).pr(6).flex_none().items_center()
      .bg("#ffffff").border_1().border_color("#9db0c5").rounded(2).cursor_pointer()
      .on_click((_e, cx) => { this.done({ run: ["app.palette", {}] }); cx.notify(); })
      .child(div().flex_1().italic().text_color("#6d6d6d").child("搜索程序和文件"))
      .child(icon("search", 16));
  }

  // ---- the glass column

  place(id, label, pic, act) {
    const hot = this.hot === id;
    return own(div().id(id)).relative().h(31).px(10).flex_none().flex().items_center().rounded(3).cursor_pointer()
      .border_1().border_color(hot ? "#ffffff70" : "#00000000")
      .on_hover(this.hover(id))
      .on_click((_e, cx) => { this.done(act); cx.notify(); })
      .when(hot, (el) => el.child(div().absolute().top(0).left(0).size_full().rounded(2).overflow_hidden().child(fill("#ffffff48", "#ffffff12"))))
      .child(div().relative().text_color("#ffffff").child(label));
  }

  glassButton(id, w, content, onClick, round) {
    const hot = this.hot === id;
    return own(div().id(id)).relative().w(w).h(25).flex_none().overflow_hidden().cursor_pointer()
      .border_1().border_color(hot ? "#ffffffb0" : "#ffffff60")
      .map((el) => (round === "l" ? el.rounded_l(3) : el.rounded_r(3).border_l(0)))
      .on_hover(this.hover(id))
      .on_click((e, cx) => { onClick(e); cx.notify(); })
      .child(fill(hot ? "#ffffff70" : "#ffffff3a", hot ? "#86d0ff50" : "#ffffff0a"))
      .child(div().absolute().top(0).left(0).w_full().h(12).bg("#ffffff18"))
      .child(div().relative().size_full().flex().items_center().justify_center().text_color("#ffffff").child(content));
  }

  places() {
    const sep = () => div().h(1).mx(8).my(3).bg("#ffffff28");
    const user = userName();
    return v_flex().flex_1().h_full().pt(50).pl(6).gap(0)
      .child(this.place("pl-user", user, "user", { run: ["tab.new", { folder: folder() }] }))
      .child(this.place("pl-docs", "文档", "folder", { run: ["tab.new", { folder: folder("Documents") }] }))
      .child(this.place("pl-pics", "图片", "folder", { run: ["tab.new", { folder: folder("Pictures") }] }))
      .child(this.place("pl-down", "下载", "folder", { run: ["tab.new", { folder: folder("Downloads") }] }))
      .child(sep())
      .child(this.place("pl-pc", "计算机", "computer", { explorer: null }))
      .child(sep())
      .child(this.place("pl-cp", "控制面板", "control", { run: ["app.settings", {}] }))
      .child(this.place("pl-dev", "设备和打印机", "computer", { run: ["app.settings", { section: "machines" }] }))
      .child(this.place("pl-def", "默认程序", "control", { run: ["app.settings", { section: "look" }] }))
      .child(this.place("pl-help", "帮助和支持", "help", { run: ["app.help", {}] }))
      .child(sep())
      .child(this.place("pl-run", "运行...", "cmd", { run: ["app.palette", {}] }))
      .child(div().flex_1())
      .child(h_flex().mb(3).pl(6)
        .child(this.glassButton("off", 78, "关机", () => this.done({ run: ["window.close", {}] }), "l"))
        .child(this.glassButton("off-more", 22, glyph("arrow", 6, 8), () => {
          // Over the arrow: the menu's bottom row, START_H above the taskbar.
          const desk = shared(DESK);
          const at = { x: LEFT_W + 97, y: Math.max(0, (desk?.h ?? 800) - 36) };
          closeOverlay(props()?.overlay);
          setShared("win7.start", { closed: Date.now() });
          openMenu([
            { label: "切换用户(W)", act: { run: ["layout.switch", {}] } },
            { label: "注销(L)", act: { run: ["layout.switch", { name: "main" }] } },
            { sep: true },
            { label: "重新启动(R)", act: { restoreAll: true } },
            { label: "睡眠(S)", act: { run: ["window.minimize", {}] } },
          ], { above: at }, { width: 150 });
        }, "r")));
  }

  picture() {
    const PICS = { "pl-docs": "folder", "pl-pics": "folder", "pl-down": "folder", "pl-pc": "computer", "pl-cp": "control", "pl-dev": "computer", "pl-def": "control", "pl-help": "help", "pl-run": "cmd" };
    const pic = PICS[this.hot];
    return div().absolute().top(0).left(7 + LEFT_W + 34).w(72).h(72).rounded(6).overflow_hidden()
      .border_1().border_color("#0d1a2ad8").relative()
      .child(fill("#f4faff", "#9cc2e6"))
      .child(div().absolute().top(0).left(0).w_full().h(36).bg("#ffffff50"))
      .child(div().absolute().top(0).left(0).size_full().rounded(5).border_1().border_color("#ffffffc0"))
      .child(div().absolute().top(10).left(10).w(52).h(52).rounded(2).overflow_hidden().border_1().border_color("#6b88a8")
        .child(pic ? div().size_full().bg("#ffffff").flex().items_center().justify_center().child(icon(pic, 44)) : image(asset("user")).w(50).h(50)));
  }

  render(_cx) {
    const desk = shared(DESK);
    const glass = div().absolute().top(22).left(0).right(0).bottom(0).rounded(6).overflow_hidden()
      .border_1().border_color("#0b1726e0").shadow_lg()
      .child(frost(desk ? { x: 0, y: desk.h - START_H + 22 } : null, ["#3d648cb4", "#132b45d0"]))
      .child(div().absolute().top(0).left(0).w_full().h(60).bg("#ffffff10"))
      .child(div().absolute().top(0).left(0).size_full().rounded(5).border_1().border_color("#ffffff58"));
    return transient(div(), props()?.overlay).size_full().relative().font_family(FONT).text_size(12)
      .child(glass)
      .child(h_flex().absolute().top(22).left(0).right(0).bottom(0).pt(8).px(7).pb(6)
        .child(v_flex().w(LEFT_W).h_full().child(this.pane()).child(this.search()))
        .child(this.places()))
      .child(this.picture());
  }
}
