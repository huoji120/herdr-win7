// The superbar, never combined: the Start orb, the pinned PowerShell, one
// labeled button per window (the one in front lit), the notification area,
// the clock and Show desktop. An agent at work fills its button with green
// progress; one that needs you, or finished while you looked away, flashes
// it orange. It also keeps "win7.places" (where each window was dropped,
// from windows.json) for the glass.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { knownAgents, nextCommand, spaces, panes, hc, shared, setShared, closeOverlay, run, settings, playSound, appHome, readTextFile, watchFolder } from "herdr";
import {
  A, FONT, DESK, TASKBAR, PLACES, fill, frost, own, icon, programIcon, terms, records, active, title,
  syncWindows, showWindow, minimizeWindow, toggleWindow, openMenu, openPopup,
  EXPLORER, CLAUDE_SEEN, claudeTitle, openExplorer, minimizeExplorer,
  GAME, openGame, minimizeGame, perform,
} from "./kit.js";
import { DdzLink, ddz } from "./ddz/net.js";
import { FXQ, FXQ_ICON, fxqOpen, toggleFxq, watchFxq } from "./fxq.js";

export const START_W = 404, START_H = 532;
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const TINT = ["#24476a88", "#0b1a2cb8"];

export default class Taskbar {
  init(_p, cx) {
    this.now = new Date();
    this.hot = null;
    this.agents = [];
    this.peeked = null;
    cx.timer.after(60000 - (Date.now() % 60000) + 50, (cx) => {
      this.now = new Date();
      cx.notify();
      cx.timer.every(60000, (cx) => { this.now = new Date(); cx.notify(); });
    });
    cx.spawn(async (cx) => {
      try { this.agents = (await knownAgents()).filter((a) => a.installed); } catch {}
      cx.notify();
    });
    // Keys: "win7.start" opens the Start menu (bind ctrl-escape to it in keys.json),
    // "win7.desktop" is Show desktop, "win7.explorer" opens 计算机, "win7.game" 斗地主.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "start") this.toggleStart();
        if (c === "desktop") this.showDesktop(terms());
        if (c === "explorer") openExplorer(null);
        if (c === "game") openGame();
        // 斗地主 from keys: host a room with the defaults, add a computer player, start.
        if (c === "ddz_host") perform({ ddz: { t: "_host", tokens: 1000, ante: 10 }, game: true });
        if (c === "ddz_bot") perform({ ddz: { t: "bot" } });
        if (c === "ddz_start") perform({ ddz: { t: "start" } });
        cx.notify();
      }
    });
    // Where windows were dropped: Herdr writes it to windows.json.
    const home = appHome();
    const load = async () => {
      try {
        const places = JSON.parse((await readTextFile(`${home}/windows.json`)) ?? "{}")?.places ?? {};
        if (JSON.stringify(places) !== JSON.stringify(shared(PLACES) ?? {})) setShared(PLACES, places);
      } catch {}
    };
    cx.spawn(async () => {
      await load();
      for (;;) {
        let paths;
        try { paths = await watchFolder(home); } catch { return; }
        if (paths.some((p) => /windows\.json$/i.test(p) || p.replace(/[\\/]+$/, "") === home.replace(/[\\/]+$/, ""))) await load();
      }
    });
    // Claude Code under a shell: its title, every 1.5 s (see CLAUDE_SEEN).
    cx.timer.every(1500, (cx) => this.pollClaude(cx));
    // Windows from before (another layout, the last build of this mod) are gone or stale.
    syncWindows(true);
    if (shared(EXPLORER)?.open) openExplorer();
    if (shared(GAME)?.open) openGame();
    // The 斗地主 table: this copy holds the connection, so the game window can close.
    this.ddz = new DdzLink();
    this.ddz.start(cx);
    // 飞行棋 (its own mod): its table, for the taskbar button.
    watchFxq(cx);
  }

  pollClaude(cx) {
    if (this.polling) return;
    this.polling = true;
    cx.spawn(async () => {
      const seen = {};
      for (const p of panes()) {
        if (!p.terminal || p.status || p.program?.agent) continue;
        try {
          const s = claudeTitle(JSON.parse((await hc(["get", p.terminal, "--json"])).stdout)?.title);
          if (s) seen[p.terminal] = s;
        } catch {}
      }
      if (JSON.stringify(seen) !== JSON.stringify(shared(CLAUDE_SEEN) ?? {})) setShared(CLAUDE_SEEN, seen);
      this.polling = false;
    });
  }

  launcher(p) {
    if (p.program?.shell || !p.program) return { run: ["tab.new", {}] };
    const a = this.agents.find((x) => x.key === p.program.key);
    return a?.run ? { run: ["tab.new", { argv: a.run }] } : null;
  }

  desk() {
    return shared(DESK) ?? null;
  }

  // ---- the Start orb

  orb() {
    return own(div().id("orb")).relative().w(56).h(TASKBAR).flex_none().flex().items_center().justify_center().cursor_pointer()
      .tooltip("开始")
      .on_hover((on, cx) => { this.hot = on ? "orb" : null; cx.notify(); })
      .on_click((_e, cx) => { this.toggleStart(); cx.notify(); })
      .child(image(`${A}/${this.hot === "orb" ? "orb-hot" : "orb"}.svg`).w(46).h(46).flex_none());
  }

  toggleStart() {
    const open = shared("win7.start");
    if (open?.id) {
      closeOverlay(open.id);
      setShared("win7.start", null);
      return;
    }
    // The press that closed the menu (outside it) was on the orb: leave it closed.
    if (open?.closed && Date.now() - open.closed < 400) return;
    const d = this.desk();
    const id = openPopup("start", START_W, START_H, { x: 0, y: Math.max(0, (d?.h ?? 800) - START_H) });
    setShared("win7.start", { id });
  }

  // ---- buttons

  face(el, o) {
    const { lit, hot, status, running, W, H } = o;
    return el.relative().h(H).rounded(3).overflow_hidden()
      .when(running || hot, (e) => e.border_1().border_color(lit ? "#ffffff90" : "#ffffff48").bg("#00000018"))
      .when(running && !lit, (e) => e.child(fill("#ffffff30", "#ffffff08")))
      .when(lit && !hot, (e) => e.child(fill("#ffffff60", "#ffffff24")))
      .when(hot, (e) => e.child(fill("#ffffff70", "#a8dcff3a")))
      .when(status === "working", (e) => e.child(div().absolute().top(0).left(0).h_full().w(W).overflow_hidden()
        .loop("width", { from: 10, to: W, period: 3200 }).child(fill("#7cf07ca0", "#1e9b1eb8"))))
      .when(status === "blocked", (e) => e.child(div().absolute().top(0).left(0).size_full()
        .loop("opacity", { from: 0.35, to: 1, period: 1400 }).child(fill("#ffd08ef0", "#f07a10f0"))))
      .when(status === "done", (e) => e.child(div().absolute().top(0).left(0).size_full().child(fill("#ffd59ae0", "#f39a3ae0"))))
      .when(running, (e) => e.child(div().absolute().top(1).left(1).right(1).h(H / 2 - 2).rounded_t(2).bg("#ffffff16")));
  }

  pinned() {
    const hot = this.hot === "pin-ps";
    return own(div().id("pin-ps")).flex_none().cursor_pointer().tooltip("Windows PowerShell")
      .on_hover((on, cx) => { this.hot = on ? "pin-ps" : this.hot === "pin-ps" ? null : this.hot; cx.notify(); })
      .on_click((_e, cx) => { run("tab.new", {}); cx.notify(); })
      .child(this.face(div().w(50), { hot, lit: false, running: false, W: 50, H: TASKBAR - 4 })
        .child(div().relative().size_full().flex().items_center().justify_center().child(icon("ps", 26))));
  }

  button(p, front) {
    const t = p.terminal;
    const id = `tb-${t}`;
    const hot = this.hot === id;
    const lit = hot || (t === front && records()[t]?.open);
    const name = title(p);
    return own(h_flex().id(id)).flex_1().min_w(44).max_w(168).cursor_pointer().tooltip(name)
      .on_hover((on, cx) => { this.hot = on ? id : this.hot === id ? null : this.hot; cx.notify(); })
      .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); this.jumpList(p, e.bounds); })
      .on_click((_e, cx) => { toggleWindow(t); cx.notify(); })
      .child(this.face(h_flex().w_full(), { hot, lit, status: p.status, running: true, W: 168, H: TASKBAR - 4 })
        .child(h_flex().relative().size_full().px(7).gap(7).items_center()
          .child(programIcon(p.program, 24))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color("#ffffff").child(name))));
  }

  explorer(front) {
    const rec = shared(EXPLORER);
    if (!rec) return null;
    const id = "tb-explorer";
    const hot = this.hot === id;
    const name = spaces().find((s) => s.id === rec.space)?.name ?? "计算机";
    return own(h_flex().id(id)).flex_1().min_w(44).max_w(168).cursor_pointer().tooltip(name)
      .on_hover((on, cx) => { this.hot = on ? id : this.hot === id ? null : this.hot; cx.notify(); })
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        const d = this.desk();
        openMenu([{ label: "Windows 资源管理器", bold: true, act: { explorer: rec.space ?? null } }, { sep: true }, { label: "关闭窗口", act: { closeExplorer: true } }],
          { x: e.bounds ? Math.max(0, e.bounds.x) : 60, y: Math.max(0, (d?.h ?? 800) - 61) });
      })
      .on_click((_e, cx) => { if (rec.open && front === "explorer") minimizeExplorer(); else openExplorer(); cx.notify(); })
      .child(this.face(h_flex().w_full(), { hot, lit: hot || (rec.open && front === "explorer"), running: true, W: 168, H: TASKBAR - 4 })
        .child(h_flex().relative().size_full().px(7).gap(7).items_center()
          .child(icon("explorer", 24))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color("#ffffff").child(name))));
  }

  game(front) {
    const rec = shared(GAME);
    const id = "tb-game";
    const hot = this.hot === id;
    const s = ddz().state;
    // Your turn while the window is down or behind: flash like a program wanting attention.
    const yours = s && s.turn === s.you && !s.seats?.[s.you]?.auto && (!rec.open || front !== "game");
    return own(h_flex().id(id)).flex_1().min_w(44).max_w(168).cursor_pointer().tooltip(yours ? "斗地主 - 轮到你了" : "斗地主")
      .on_hover((on, cx) => { this.hot = on ? id : this.hot === id ? null : this.hot; cx.notify(); })
      .on_click((_e, cx) => { if (rec.open && front === "game") minimizeGame(); else openGame(); cx.notify(); })
      .child(this.face(h_flex().w_full(), { hot, lit: hot || (rec.open && front === "game"), status: yours ? "blocked" : null, running: true, W: 168, H: TASKBAR - 4 })
        .child(h_flex().relative().size_full().px(7).gap(7).items_center()
          .child(icon("cards", 24))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color("#ffffff").child(yours ? "斗地主 · 轮到你" : "斗地主"))));
  }

  /** 飞行棋's button: while its window is open or you're at a table; a click opens or hides its window. */
  fxq() {
    const f = shared(FXQ) ?? {};
    const open = fxqOpen();
    const id = "tb-fxq";
    const hot = this.hot === id;
    const name = f.text ? `飞行棋 · ${f.text}` : "飞行棋";
    return own(h_flex().id(id)).flex_1().min_w(44).max_w(168).cursor_pointer().tooltip(name)
      .on_hover((on, cx) => { this.hot = on ? id : this.hot === id ? null : this.hot; cx.notify(); })
      .on_click((_e, cx) => { toggleFxq(); cx.notify(); })
      .child(this.face(h_flex().w_full(), { hot, lit: hot || open, status: f.yours && !open ? "blocked" : null, running: true, W: 168, H: TASKBAR - 4 })
        .child(h_flex().relative().size_full().px(7).gap(7).items_center()
          .child(icon(FXQ_ICON, 24))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color("#ffffff").child(name))));
  }

  jumpList(p, b) {
    const act = this.launcher(p);
    const items = [{ label: p.program?.shell ? "Windows PowerShell" : p.program?.name ?? "程序", bold: true, act, disabled: !act }];
    if (act) items.push({ label: "新建窗口", act });
    items.push({ sep: true });
    items.push({ label: records()[p.terminal]?.open ? "最小化窗口" : "还原窗口", act: records()[p.terminal]?.open ? { min: p.terminal } : { show: p.terminal } });
    items.push({ label: "关闭窗口", act: { close: [p.terminal] } });
    const d = this.desk();
    const h = items.reduce((n, it) => n + (it.sep ? 7 : 24), 6);
    openMenu(items, { x: b ? Math.max(0, b.x) : 60, y: Math.max(0, (d?.h ?? 800) - h - 2) });
  }

  // ---- the notification area

  trayIcon(id, name, tip, onClick) {
    return own(div().id(id)).w(24).h(28).flex_none().flex().items_center().justify_center().rounded(2).cursor_pointer()
      .tooltip(tip).hover((s) => s.bg("#ffffff26"))
      .when(Boolean(onClick), (el) => el.on_click((_e, cx) => { onClick(); cx.notify(); }))
      .child(icon(name, 16));
  }

  tray(live) {
    const blocked = live.filter((p) => p.status === "blocked");
    const done = live.filter((p) => p.status === "done");
    const working = live.filter((p) => p.status === "working");
    const needs = [...blocked, ...done];
    const flagTip = needs.length
      ? `${blocked.length ? `${blocked.length} 个代理等待处理` : ""}${blocked.length && done.length ? "，" : ""}${done.length ? `${done.length} 个代理已完成` : ""}`
      : working.length ? `${working.length} 个代理正在工作` : "没有需要处理的问题";
    const sound = settings()?.sounds?.enabled !== false;
    const d = this.now;
    const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    const date = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    return h_flex().relative().h_full().flex_none().items_center().gap(1).pl(6)
      .child(own(div().id("lang")).h(22).px(4).mr(4).flex().items_center().rounded(2).border_1().border_color("#ffffff40")
        .tooltip("中文(简体，中国)").text_size(11).font_weight(700).text_color("#ffffff").child("CH"))
      .child(this.trayIcon("tray-up", "tray-up", "显示隐藏的图标"))
      .child(this.trayIcon("tray-flag", needs.length ? "tray-flag-alert" : "tray-flag", flagTip, needs.length ? () => showWindow(needs[0].terminal) : null))
      .child(this.trayIcon("tray-net", "tray-net", "网络\nInternet 访问"))
      .child(this.trayIcon("tray-vol", sound ? "tray-vol" : "tray-mute", sound ? "扬声器: 提示音已打开" : "扬声器: 提示音已关闭"))
      .child(own(div().id("clock")).h(TASKBAR - 4).px(8).ml(2).flex_none().rounded(2).cursor_pointer()
        .tooltip(`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`)
        .hover((s) => s.bg("#ffffff22"))
        .child(v_flex().size_full().items_center().justify_center().text_size(12).text_color("#ffffff").line_height("15px")
          .child(div().child(time)).child(div().child(date))))
      .child(own(div().id("peek")).w(15).h_full().ml(6).flex_none().cursor_pointer().relative()
        .tooltip("显示桌面").border_l(1).border_color("#ffffff40")
        .hover((s) => s.bg("#ffffff30"))
        .on_click((_e, cx) => { this.showDesktop(live); cx.notify(); })
        .child(div().absolute().top(0).left(0).w(1).h_full().bg("#00000050"))
        .child(fill("#ffffff22", "#ffffff08")));
  }

  showDesktop(live) {
    const open = live.filter((p) => records()[p.terminal]?.open).map((p) => p.terminal);
    if (open.length) {
      this.peeked = open;
      for (const t of open) minimizeWindow(t);
    } else {
      for (const t of this.peeked ?? live.map((p) => p.terminal)) if (live.some((p) => p.terminal === t)) showWindow(t, { focus: false });
      this.peeked = null;
    }
  }

  /**
   * Claude Code recognized by its title reports no "done": it is done when it
   * stops working while its window isn't in front, until that window is.
   */
  finished(live, front) {
    this.was ??= {};
    this.done ??= new Set();
    for (const p of live) {
      if (!p.guessed) continue;
      if (this.was[p.terminal] === "working" && p.status === "idle" && front !== p.terminal) {
        this.done.add(p.terminal);
        if (settings()?.sounds?.enabled !== false) playSound("done");
      }
      if (front === p.terminal || p.status === "working") this.done.delete(p.terminal);
      this.was[p.terminal] = p.status;
    }
    return live.map((p) => (this.done.has(p.terminal) ? { ...p, status: "done" } : p));
  }

  render(cx) {
    this.ddz?.pump(cx);
    const front = active();
    const live = this.finished(syncWindows(), front);
    const d = this.desk();
    return h_flex().id("taskbar").relative().size_full().items_center().font_family(FONT)
      .child(frost(d ? { x: 0, y: d.h } : null, TINT))
      .child(div().absolute().top(0).left(0).w_full().h(1).bg("#0a1522b0"))
      .child(div().absolute().top(1).left(0).w_full().h(1).bg("#ffffff50"))
      .child(div().absolute().top(2).left(0).w_full().h(TASKBAR / 2 - 2).bg("#ffffff10"))
      .child(this.orb())
      .child(h_flex().relative().flex_1().min_w(0).h_full().items_center().gap(3).pl(2).pr(4).overflow_hidden()
        .child(this.pinned())
        .when(Boolean(shared(EXPLORER)), (el) => el.child(this.explorer(front)))
        .when(Boolean(shared(GAME)), (el) => el.child(this.game(front)))
        .when(Boolean(shared(FXQ)?.installed && (fxqOpen() || shared(FXQ)?.inRoom)), (el) => el.child(this.fxq()))
        .children(live.map((p) => this.button(p, front))))
      .child(this.tray(live));
  }
}
