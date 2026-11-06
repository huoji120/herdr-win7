// Explorer ("计算机"): spaces are its drives, a space's terminals its
// folders. Double-click a drive to go in, a folder to bring its window up;
// 新建文件夹 starts a terminal there. Glass on top with Back, the address
// bar and the search box; the command bar, the navigation pane, the tiles
// and the details pane below.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, spaces, shared, setShared, run } from "herdr";
import {
  FONT, EXPLORER, fill, frost, own, icon, programIcon, terms, title, active, raise,
  windowSpot, originOf, showWindow, confirmClose, openMenu, openExplorer, minimizeExplorer, closeExplorer,
} from "./kit.js";
import { captions, GLASS, GLASS_DIM } from "./frame.js";

const STATUS = { working: "正在运行", blocked: "等待你的处理", done: "已完成", idle: "空闲" };
const drive = (i) => String.fromCharCode(67 + Math.min(i, 23));

export default class Explorer {
  init() {
    this.hot = null;
    this.down = null;
    this.sel = null;
    this.over = null;
    this.live = null;
  }

  go(space) {
    this.sel = null;
    setShared(EXPLORER, { ...(shared(EXPLORER) ?? {}), space });
  }

  hover(id) {
    return (on, cx) => { this.over = on ? id : this.over === id ? null : this.over; cx.notify(); };
  }

  // ---- bits

  tool(id, label, onClick, arrow = false) {
    const hot = this.over === id;
    return own(h_flex().id(id)).relative().h(24).px(8).gap(4).items_center().rounded(3).cursor_pointer()
      .border_1().border_color(hot ? "#a8c6e8" : "#00000000")
      .on_hover(this.hover(id))
      .on_click((_e, cx) => { onClick(); cx.notify(); })
      .when(hot, (el) => el.child(div().absolute().top(0).left(0).size_full().rounded(2).overflow_hidden().child(fill("#fbfdff", "#d6e8fa"))))
      .child(div().relative().text_color("#1e395b").child(label))
      .when(arrow, (el) => el.child(div().relative().text_size(8).text_color("#1e395b").child("▼")));
  }

  navItem(id, pic, label, selected, onClick, indent = 0) {
    const hot = this.over === id;
    return own(h_flex().id(id)).relative().h(22).ml(4 + indent).mr(4).px(4).gap(6).items_center().rounded(2).cursor_pointer()
      .border_1().border_color(selected ? "#84acdd" : hot ? "#b8d6fb" : "#00000000")
      .bg(selected ? "#cce4fb" : hot ? "#e8f2fd" : "#00000000")
      .on_hover(this.hover(id))
      .on_click((_e, cx) => { onClick(); cx.notify(); })
      .child(icon(pic, 16))
      .child(div().min_w(0).truncate().text_color("#000000").child(label));
  }

  tile(id, pic, lines, onOpen, onMenu) {
    const sel = this.sel === id, hot = this.over === id;
    return own(h_flex().id(id)).relative().w(256).h(60).px(6).gap(8).items_center().rounded(3).flex_none().cursor_pointer()
      .border_1().border_color(sel ? "#7da2ce" : hot ? "#b8d6fb" : "#00000000")
      .on_hover(this.hover(id))
      .on_click((e, cx) => {
        cx.stop_propagation();
        this.sel = id;
        if (e.click_count >= 2) onOpen();
        cx.notify();
      })
      .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); this.sel = id; onMenu(e.position); cx.notify(); })
      .when(sel || hot, (el) => el.child(div().absolute().top(0).left(0).size_full().rounded(2).overflow_hidden()
        .child(sel ? fill("#dcebfc", "#c1dbfc") : fill("#f2f8ff", "#e1effe"))))
      .child(div().relative().flex_none().child(pic))
      .child(v_flex().relative().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_color("#000000").child(lines[0]))
        .children(lines.slice(1).map((l) => (typeof l === "string" ? div().truncate().text_color("#6d6d6d").child(l) : l))));
  }

  // ---- views

  computer(all) {
    const tiles = all.map((s, i) => {
      const n = terms().filter((p) => s.tabs.some((t) => t.id === p.tab)).length;
      const bar = div().relative().w(150).h(13).border_1().border_color("#8b9fb6").bg("#e6e6e6").overflow_hidden()
        .child(div().absolute().top(0).left(0).h_full().w(Math.min(148, 8 + n * 18)).overflow_hidden()
          .child(fill(s.status === "blocked" ? "#f7c38e" : "#7fc4f4", s.status === "blocked" ? "#e2741a" : "#2a82d4")));
      return this.tile(`d-${s.id}`, icon("drive", 48), [`${s.name} (${drive(i)}:)`, bar, `${n} 个终端${s.machine ? ` · ${s.machine}` : ""}`],
        () => this.go(s.id),
        (at) => openMenu([
          { label: "打开(O)", bold: true, act: { explorer: s.id } },
          { label: "新建终端(W)", act: { run: ["tab.new", { space: s.id }] } },
          { sep: true },
          { label: "重命名(M)", act: { run: ["space.rename", { id: s.id }] } },
        ], at, { width: 180 }));
    });
    return v_flex().gap(6)
      .child(h_flex().gap(6).items_center().text_color("#1e395b")
        .child(div().child(`硬盘 (${all.length})`)).child(div().flex_1().h(1).bg("#e2eaf3")))
      .child(h_flex().flex_wrap().gap(6).children(tiles));
  }

  folder(space) {
    const live = terms().filter((p) => space.tabs.some((t) => t.id === p.tab));
    const tiles = live.map((p) => {
      const pic = div().relative().w(48).h(48).child(icon("folder", 48))
        .child(div().absolute().right(0).bottom(2).child(programIcon(p.program, 20)));
      const what = p.program?.shell ? "Windows PowerShell" : p.program?.name ?? "程序";
      return this.tile(`f-${p.terminal}`, pic, [title(p), p.status ? `${what} · ${STATUS[p.status] ?? p.status}` : what, p.cwd ?? ""],
        () => showWindow(p.terminal),
        (at) => openMenu([
          { label: "打开(O)", bold: true, act: { show: p.terminal } },
          { sep: true },
          { label: "删除(D)", act: { close: [p.terminal] } },
          { label: "重命名(M)", act: { run: ["tab.rename", { id: p.tab }] } },
        ], at, { width: 170 }));
    });
    if (!tiles.length) return div().pt(20).w_full().text_center().text_color("#6d6d6d").child("该文件夹为空。");
    return h_flex().flex_wrap().gap(6).children(tiles);
  }

  // ---- the window

  render(_cx) {
    const p = props() ?? {};
    const rec = shared(EXPLORER) ?? {};
    const all = spaces();
    const space = all.find((s) => s.id === rec.space) ?? null;
    const max = Boolean(p.max);
    const front = active() === "explorer";
    const spot = windowSpot("explorer", max);
    const key = spot ? `${spot.x},${spot.y}` : "";
    if (key !== this.spotKey) { this.spotKey = key; this.live = null; }
    const at = this.live ?? spot;
    const here = space ? space.name : "计算机";
    const newFolder = () => (space ? run("tab.new", { space: space.id }) : run("space.new", {}));
    const blankMenu = (pos) => openMenu([
      { label: "刷新(E)", act: { refresh: true } },
      { sep: true },
      { label: space ? "新建文件夹(W)" : "新建工作区(W)", act: { run: space ? ["tab.new", { space: space.id }] : ["space.new", {}] } },
    ], pos, { width: 170 });

    const back = own(div().id("back")).w(28).h(28).flex_none().rounded(14).overflow_hidden().relative().cursor_pointer()
      .border_1().border_color(space ? "#24508cd0" : "#6f87a3a0")
      .on_click((_e, cx) => { if (space) this.go(null); cx.notify(); })
      .child(fill(space ? "#8fd0ff" : "#dfe8f1", space ? "#1f63b6" : "#a9b9ca"))
      .child(div().absolute().top(1).left(4).w(18).h(11).rounded(9).bg("#ffffff60"))
      .child(div().relative().size_full().flex().items_center().justify_center().text_size(14).font_weight(700).text_color("#ffffff").child("←"));
    const fwd = div().w(22).h(22).flex_none().rounded(11).overflow_hidden().relative().border_1().border_color("#6f87a3a0")
      .child(fill("#dfe8f1", "#a9b9ca"))
      .child(div().relative().size_full().flex().items_center().justify_center().text_size(11).font_weight(700).text_color("#ffffff").child("→"));
    const crumb = (id, label, onClick) => own(div().id(id)).h_full().px(4).flex().items_center().rounded(2).cursor_pointer().text_color("#000000")
      .hover((s) => s.bg("#e5f3fb"))
      .on_click((_e, cx) => { onClick(); cx.notify(); })
      .child(label);
    const address = own(h_flex().id("address")).flex_1().min_w(0).h(24).px(4).gap(2).items_center().bg("#ffffffe8").border_1().border_color("#7d97b6").rounded(2)
      .child(icon("computer", 16)).child(div().px(2).text_color("#555555").child("▸"))
      .child(crumb("c-pc", "计算机", () => this.go(null)))
      .when(Boolean(space), (el) => el.child(div().px(2).text_color("#555555").child("▸")).child(crumb("c-sp", space.name, () => {})));
    const search = h_flex().w(210).h(24).px(6).items_center().bg("#ffffffe8").border_1().border_color("#7d97b6").rounded(2)
      .child(div().flex_1().min_w(0).truncate().italic().text_color("#8d8d8d").child(`搜索 ${here}`)).child(icon("search", 14));

    const toolbar = h_flex().relative().h(34).flex_none().px(6).gap(2).items_center().border_b(1).border_color("#a0afc3")
      .child(fill("#f8fbfe", "#dce7f4"))
      .child(this.tool("t-org", "组织", () => blankMenu(undefined), true))
      .child(this.tool("t-new", space ? "新建文件夹" : "新建工作区", newFolder))
      .when(!space, (el) => el.child(this.tool("t-cp", "打开控制面板", () => run("app.settings", {}))))
      .when(Boolean(space && this.sel?.startsWith("f-")), (el) => el
        .child(this.tool("t-open", "打开", () => showWindow(this.sel.slice(2))))
        .child(this.tool("t-del", "删除", () => confirmClose([this.sel.slice(2)]))));

    const nav = v_flex().w(190).flex_none().h_full().pt(8).gap(1).bg("#ffffff").border_r(1).border_color("#d6e2ef").overflow_y_scroll().id("nav")
      .child(this.navItem("n-pc", "computer", "计算机", !space, () => this.go(null)))
      .children(all.map((s, i) => this.navItem(`n-${s.id}`, "drive", `${s.name} (${drive(i)}:)`, space?.id === s.id, () => this.go(s.id), 14)))
      .child(div().h(10))
      .child(this.navItem("n-cp", "control", "控制面板", false, () => run("app.settings", {})));

    const count = space ? terms().filter((x) => space.tabs.some((t) => t.id === x.tab)).length : all.length;
    const selP = this.sel?.startsWith("f-") ? terms().find((x) => x.terminal === this.sel.slice(2)) : null;
    const details = h_flex().relative().h(46).flex_none().px(12).gap(10).items_center().border_t(1).border_color("#bdd0e6")
      .child(fill("#f8fbfe", "#e3edf8"))
      .child(div().relative().child(selP ? programIcon(selP.program, 32) : icon(space ? "folder" : "computer", 32)))
      .child(v_flex().relative().min_w(0).child(div().truncate().text_color("#000000").child(selP ? title(selP) : `${count} 个对象`))
        .when(Boolean(selP), (el) => el.child(div().truncate().text_color("#6d6d6d").child(selP.cwd ?? ""))));

    const content = div().id("content").flex_1().min_w(0).h_full().p(10).bg("#ffffff").overflow_y_scroll()
      .on_click((_e, cx) => { this.sel = null; cx.notify(); })
      .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); blankMenu(e.position); })
      .child(space ? this.folder(space) : this.computer(all));

    const client = own(v_flex().id("client")).relative().flex_1().min_h(0).mx(max ? 0 : 7).mb(max ? 0 : 7)
      .border_1().border_color("#5f7d9d").bg("#ffffff")
      .on_mouse_down("left", (_e, cx) => { raise("explorer"); cx.stop_propagation(); })
      .child(toolbar)
      .child(h_flex().flex_1().min_h(0).child(nav).child(content))
      .child(details);

    return v_flex().id("explorer").relative().size_full().font_family(FONT).text_size(12)
      .when(!max, (el) => el.rounded(7).shadow_lg()).overflow_hidden().border_1().border_color("#0c1726d8").bg("#b4cde6")
      .on_mouse_move((e, cx) => {
        const o = originOf(e);
        if (o && (!this.live || Math.abs(o.x - this.live.x) + Math.abs(o.y - this.live.y) > 0.5)) { this.live = o; cx.notify(); }
      })
      .on_mouse_down("left", () => raise("explorer"))
      .child(frost(at, front ? GLASS : GLASS_DIM))
      .child(div().absolute().top(0).left(0).size_full().when(!max, (el) => el.rounded(6)).border_1().border_color("#ffffff90"))
      .child(div().absolute().top(0).left(0).w_full().h(30).bg("#ffffff14"))
      .child(div().relative().h(24).flex_none()
        .child(captions(this, { id: "ex-cap", max, front, onMin: () => minimizeExplorer(), onMax: () => openExplorer(undefined, { max: !max }), onClose: () => closeExplorer() })))
      .child(h_flex().relative().h(36).flex_none().px(max ? 4 : 8).pb(4).gap(5).items_center()
        .child(back).child(fwd).child(address).child(search))
      .child(client);
  }
}
