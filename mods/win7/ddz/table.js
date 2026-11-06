// The 斗地主 window: a Win7 game window (glass frame, 游戏 / 帮助 menus) over
// green felt. Not at a table: create a room (starting tokens and ante) or join
// one by address. At the table's lobby: the seats, the address to give the
// others, computer players and Start for the host. In a game: the two others
// left and right (cards left, role, tokens, what they played, the clock), the
// bottom cards, 赖子 and multiple on top, your hand below with 叫分 or
// 不出 / 提示 / 出牌, and 托管. Every rule lives on the server; this only
// draws its view and sends what you do.

import { div, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, shared, exec, appHome } from "herdr";
import {
  A, FONT, GAME, fill, glossy, frost, own, icon, active, raise, windowSpot, originOf, openMenu,
  openGame, minimizeGame, closeGame,
} from "../kit.js";
import { captions, GLASS, GLASS_DIM } from "../frame.js";
import { ddz, ddzSend } from "./net.js";
import { analyze, options, isRed, isWild, label, rank, rankLabel, SUITS, suit, NAMES, BOMB_NAMES } from "./rules.js";

const CARD = { w: 62, h: 88, step: 27 };
const SMALL = { w: 42, h: 60, step: 17 };
const TINY = { w: 30, h: 42, step: 12 };

export default class Table {
  init(_p, cx) {
    this.hot = null;
    this.down = null;
    this.over = null;
    this.live = null;
    this.sel = new Set();
    this.hint = 0;
    this.seen = null;
    this.deadlineAt = null;
    this.inTokens = InputState.new({ value: "1000" });
    this.inAnte = InputState.new({ value: "10" });
    this.inAddr = InputState.new({ value: "" });
    this.inPass = InputState.new({ value: "" });
    this.inHostPass = InputState.new({ value: "" });
    this.copied = 0;
    // Who's hosting on the LAN, as soon as the window opens.
    if (ddz().status !== "online") ddzSend({ t: "_scan" });
    // The clock and errors fade: redraw once a second while either shows.
    cx.timer.every(1000, (cx) => {
      const d = ddz();
      if ((d.state && this.deadlineAt && this.deadlineAt > Date.now() - 1000) || (d.toast && Date.now() - d.toast.at < 4000)) cx.notify();
    });
  }

  hover(id) {
    return (on, cx) => { this.over = on ? id : this.over === id ? null : this.over; cx.notify(); };
  }

  // ---- parts

  /** A Win7 push button. */
  button(id, text, onClick, o = {}) {
    const hot = this.over === id && !o.disabled;
    const face = o.disabled ? ["#f4f4f4", "#f4f4f4", "#f4f4f4", "#f4f4f4"]
      : hot ? ["#eaf6fd", "#d9f0fc", "#bee6fd", "#a7d9f5"] : ["#f2f2f2", "#ebebeb", "#dddddd", "#cfcfcf"];
    return own(div().id(id)).relative().w(o.w ?? 86).h(o.h ?? 28).flex_none().rounded(3).overflow_hidden()
      .when(!o.disabled, (el) => el.cursor_pointer())
      .border_1().border_color(o.disabled ? "#adb2b5" : hot ? "#3c7fb1" : o.primary ? "#3399ff" : "#707070")
      .on_hover(this.hover(id))
      .on_click((_e, cx) => { if (!o.disabled) onClick(); cx.notify(); })
      .child(glossy(...face))
      .child(div().absolute().top(0).left(0).size_full().rounded(2).border_1().border_color(o.primary && !hot ? "#bfe6ff" : "#ffffffb0"))
      .child(div().relative().size_full().flex().items_center().justify_center()
        .text_size(o.size ?? 13).text_color(o.disabled ? "#8d8d8d" : "#000000").child(text));
  }

  field(state, w, key) {
    return own(div().id(`f-${key}`)).w(w).h(26).px(6).flex().items_center().bg("#ffffff").border_1().border_color("#7a96b5").rounded(2)
      .child(Input.new(state).w_full().text_size(13).text_color("#000000"));
  }

  card(id, size, o = {}) {
    const wild = isWild(id, o.wild);
    const joker = id >= 52;
    const color = isRed(id) ? "#c8102e" : "#111111";
    const big = size === CARD;
    let el = div().relative().w(size.w).h(size.h).flex_none().rounded(big ? 5 : 4).overflow_hidden()
      .bg("#ffffff").border_1().border_color(wild ? "#e0a100" : o.sel ? "#3399ff" : "#8a8a8a")
      .child(fill("#ffffff", "#ecefe8"));
    const corner = v_flex().absolute().top(big ? 3 : 2).left(big ? 4 : 3).items_center().line_height(big ? "17px" : "12px");
    if (joker) {
      for (const ch of ["J", "O", "K", "E", "R"]) corner.child(div().text_size(big ? 11 : 8).font_weight(700).text_color(color).child(ch));
      el = el.child(corner).child(div().absolute().bottom(big ? 6 : 3).right(big ? 6 : 3).text_size(big ? 20 : 13).text_color(color).child(id === 53 ? "大" : "小"));
    } else {
      corner.child(div().text_size(big ? 17 : 12).font_weight(700).text_color(color).child(label(id)))
        .child(div().text_size(big ? 14 : 10).text_color(color).child(SUITS[suit(id)]));
      el = el.child(corner);
      if (big) el = el.child(div().absolute().bottom(8).right(8).text_size(26).text_color(color).child(SUITS[suit(id)]));
    }
    if (wild) {
      el = el.child(div().absolute().top(0).right(0).px(big ? 4 : 2).rounded_bl(4).bg("#f0b400").text_size(big ? 11 : 8).font_weight(700).text_color("#ffffff").child("赖"));
      if (o.as != null && o.as !== rank(id)) el = el.child(div().absolute().bottom(0).left(0).right(0).h(big ? 18 : 13).bg("#f0b400e0").flex().items_center().justify_center()
        .text_size(big ? 11 : 8).font_weight(700).text_color("#ffffff").child(`当${rankLabel(o.as)}`));
    }
    return el;
  }

  back(size) {
    return div().relative().w(size.w).h(size.h).flex_none().rounded(4).overflow_hidden().border_1().border_color("#0d2a5c")
      .child(fill("#3a7bd5", "#163f8a"))
      .child(div().absolute().top(3).left(3).right(3).bottom(3).rounded(3).border_1().border_color("#ffffff90"))
      .child(div().absolute().top(0).left(0).w_full().h(size.h / 2).bg("#ffffff18"));
  }

  /** Overlapped cards. `wrap` gets each card's element (selection). */
  fan(ids, size, o = {}) {
    const n = ids.length;
    const lift = o.lift ? 16 : 0;
    const row = div().relative().flex_none().w(n ? size.step * (n - 1) + size.w : 0).h(size.h + lift);
    ids.forEach((id, i) => {
      let c = div().absolute().left(i * size.step).top(o.sel?.has(id) ? 0 : lift).child(this.card(id, size, { wild: o.wild, as: o.as?.[id], sel: o.sel?.has(id) }));
      if (o.pick) c = own(c.id(`c-${id}`)).cursor_pointer().on_click((_e, cx) => { o.pick(id); cx.notify(); });
      row.child(c);
    });
    return row;
  }

  pill(text, bg, color = "#ffffff") {
    return div().px(6).py(1).rounded(8).bg(bg).text_size(11).font_weight(700).text_color(color).child(text);
  }

  // ---- views

  panel(children, w = 520) {
    return v_flex().w(w).p(20).gap(12).rounded(6).relative().overflow_hidden().border_1().border_color("#0d3a17")
      .shadow_lg()
      .child(fill("#ffffffee", "#e8f0e6ee"))
      .child(div().absolute().top(0).left(0).size_full().rounded(5).border_1().border_color("#ffffff"))
      .children(children.map((c) => c.relative()));
  }

  lobby(d) {
    const err = d.status === "error" || d.status === "lost" ? d.error : null;
    const busy = d.status === "connecting";
    return this.panel([
      h_flex().gap(12).items_center()
        .child(icon("cards", 48))
        .child(v_flex().child(div().text_size(20).text_color("#1e395b").child("局域网斗地主"))
          .child(div().text_color("#4d4d4d").child("三人一桌，带赖子，筹码对局；人不够可以加电脑。"))),
      div().h(1).bg("#c9d6c4"),
      div().text_size(14).text_color("#1e395b").child("创建房间（你当房主）"),
      h_flex().gap(10).items_center()
        .child(div().text_color("#333").child("每人初始筹码")).child(this.field(this.inTokens, 110, "tokens"))
        .child(div().text_color("#333").child("底注")).child(this.field(this.inAnte, 80, "ante"))
        .child(div().flex_1())
        .child(this.button("host", "创建房间", () => ddzSend({ t: "_host", tokens: Number(this.inTokens.value()) || 1000, ante: Number(this.inAnte.value()) || 10, password: this.inHostPass.value() }), { primary: true, disabled: busy })),
      h_flex().gap(10).items_center()
        .child(div().text_color("#333").child("房间密码")).child(this.field(this.inHostPass, 110, "hostpass"))
        .child(div().text_color("#8d8d8d").text_size(11).child("留空自动生成；牌局内容用它 AES 加密")),
      div().text_color("#6d6d6d").text_size(11).child("每局输赢 = 叫分 × 倍数 × 底注（地主一人对两家）。首次开房时 Windows 防火墙可能询问 node，请允许专用网络。"),
      div().h(1).bg("#c9d6c4"),
      h_flex().gap(8).items_center()
        .child(div().text_size(14).text_color("#1e395b").child("加入房间"))
        .child(div().text_color("#6d6d6d").text_size(11).child(d.scanning ? "正在搜索局域网…" : `局域网里找到 ${(d.rooms ?? []).length} 个房间`))
        .child(div().flex_1())
        .child(this.button("scan", "刷新", () => ddzSend({ t: "_scan" }), { w: 60, h: 24, size: 12, disabled: d.scanning })),
      v_flex().gap(4).children((d.rooms ?? []).map((r) => {
        const id = `room-${r.addr}`;
        const picked = this.inAddr.value() === r.addr;
        return own(h_flex().id(id)).h(34).px(10).gap(10).items_center().rounded(3).cursor_pointer()
          .border_1().border_color(picked ? "#7da2ce" : this.over === id ? "#b8d6fb" : "#c9d6c4").bg(picked ? "#dcebfc" : "#ffffff")
          .on_hover(this.hover(id))
          .on_click((_e, cx) => { this.inAddr.set_value(r.addr); cx.notify(); })
          .child(icon("cards", 20))
          .child(div().text_color("#000").child(`${r.name} 的房间`))
          .child(div().text_color("#6d6d6d").child(`${r.players}/3 人 · ${{ lobby: "等待中", bid: "叫分中", play: "对局中", over: "刚打完" }[r.phase] ?? r.phase}`))
          .child(div().flex_1())
          .child(div().text_color("#8d8d8d").text_size(11).child(r.addr));
      })),
      h_flex().gap(10).items_center()
        .child(div().text_color("#333").child("地址")).child(this.field(this.inAddr, 180, "addr"))
        .child(div().text_color("#333").child("密码")).child(this.field(this.inPass, 100, "pass"))
        .child(div().flex_1())
        .child(this.button("join", "加入", () => ddzSend({ t: "_join", addr: this.inAddr.value(), password: this.inPass.value() }), { primary: true, disabled: busy })),
      busy ? div().text_color("#1e395b").child("正在连接…") : err ? div().text_color("#c42b1c").child(err) : div().h(0),
    ], 560);
  }

  /** The command that seats an AI (Claude Code here) at this table through mcp.mjs. */
  aiCommand(s) {
    const d = ddz();
    const host = s.host ? (s.ips[0] ?? "127.0.0.1") : d.addr.split(":")[0];
    return `claude mcp add ddz -- node "${appHome()}/mods/win7/ddz/mcp.mjs" --host ${host}:${s.port} --password ${d.password ?? ""}`;
  }

  copy(text) {
    this.copied = Date.now();
    exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value $args[0]", text]).catch(() => {});
  }

  room(s) {
    const rows = s.seats.map((p, i) => {
      if (!p) return h_flex().h(44).px(10).gap(10).items_center().rounded(4).border_1().border_color("#c9d6c4")
        .child(div().w(36).h(36).rounded(4).bg("#dfe7dc")).child(div().text_color("#8d8d8d").child("等待玩家…"));
      return h_flex().h(44).px(10).gap(10).items_center().rounded(4).border_1().border_color("#9fb99a").bg("#ffffff")
        .child(this.avatar(p, 36))
        .child(div().text_size(14).text_color("#000").child(p.name))
        .when(i === 0, (el) => el.child(this.pill("房主", "#3a7bd5")))
        .when(i === s.you, (el) => el.child(this.pill("你", "#5aa81e")))
        .when(p.bot, (el) => el.child(this.pill("电脑", "#8d8d8d")))
        .when(p.ai, (el) => el.child(this.pill("AI", "#7a3db8")))
        .child(div().flex_1())
        .child(div().text_color("#7a5a00").child(`筹码 ${p.tokens}`))
        .when(s.host && p.bot, (el) => el.child(this.button(`kick-${i}`, "移除", () => ddzSend({ t: "kick", seat: i }), { w: 56, h: 24, size: 12 })));
    });
    const full = s.seats.every(Boolean);
    return this.panel([
      h_flex().gap(12).items_center().child(icon("cards", 40))
        .child(v_flex().child(div().text_size(18).text_color("#1e395b").child("斗地主房间"))
          .child(div().text_color("#4d4d4d").child(`每人 ${s.config.tokens} 筹码 · 底注 ${s.config.ante}`))),
      s.host
        ? v_flex().gap(4).p(10).rounded(4).bg("#fff8dc").border_1().border_color("#e6cf7a")
          .child(h_flex().gap(8).items_center().child(div().text_color("#5c4500").child("房间密码"))
            .child(div().text_size(18).font_weight(700).text_color("#000").child(ddz().password ?? "")))
          .child(div().text_color("#5c4500").child("其他人打开斗地主会自动搜到这个房间，输入密码即可加入；也可以手动输入："))
          .child(div().font_weight(700).text_color("#000").child(s.ips.length ? s.ips.map((ip) => `${ip}:${s.port}`).join("   ") : `本机:${s.port}`))
        : div().text_color("#4d4d4d").child(`已连接到 ${ddz().addr}（加密）`),
      v_flex().gap(6).children(rows),
      v_flex().gap(4).p(8).rounded(4).bg("#eef4fb").border_1().border_color("#b8cde6")
        .child(h_flex().gap(8).items_center()
          .child(div().text_color("#1e395b").child("让 AI 来打：在要上桌的那台电脑的 Claude Code 里加这个 MCP，再对它说「去斗地主」"))
          .child(div().flex_1())
          .child(this.button("copy-ai", Date.now() - this.copied < 3000 ? "已复制" : "复制命令", () => this.copy(this.aiCommand(s)), { w: 80, h: 24, size: 12 })))
        .child(div().text_size(11).text_color("#4d4d4d").child(this.aiCommand(s))),
      div().text_color("#1e395b").child(s.msg ?? ""),
      h_flex().gap(8).items_center()
        .when(s.host, (el) => el
          .child(div().text_color("#333").child("筹码")).child(this.field(this.inTokens, 90, "tokens2"))
          .child(div().text_color("#333").child("底注")).child(this.field(this.inAnte, 60, "ante2"))
          .child(this.button("cfg", "应用", () => ddzSend({ t: "config", tokens: Number(this.inTokens.value()), ante: Number(this.inAnte.value()) }), { w: 60 })))
        .child(div().flex_1())
        .when(s.host, (el) => el.child(this.button("bot", "添加电脑", () => ddzSend({ t: "bot" }), { disabled: full })))
        .when(s.host, (el) => el.child(this.button("start", "开始游戏", () => ddzSend({ t: "start" }), { primary: true, disabled: !full })))
        .child(this.button("leave", "离开房间", () => ddzSend({ t: "_leave" }))),
    ], 560);
  }

  avatar(p, size) {
    return div().w(size).h(size).flex_none().rounded(4).overflow_hidden().border_1().border_color("#ffffffc0").bg("#ffffff")
      .flex().items_center().justify_center()
      .child(p.bot ? icon("computer", size - 6) : image(`${A}/icons/user.svg`).w(size - 2).h(size - 2));
  }

  /** What a seat put on the table this round. */
  played(s, i, size) {
    const t = s.table[i];
    if (!t) return div().h(size.h);
    if (t === "pass") return div().h(size.h).flex().items_center().text_size(20).text_color("#ffe9a8").child("不出");
    if (t.bid !== undefined) return div().h(size.h).flex().items_center().text_size(20).text_color("#ffe9a8").child(t.bid ? `${t.bid} 分` : "不叫");
    return this.fan(t.cards, size, { wild: s.wild, as: t.as });
  }

  seatInfo(s, i, align) {
    const p = s.seats[i];
    if (!p) return div();
    const turn = s.turn === i;
    const secs = turn && this.deadlineAt ? Math.max(0, Math.ceil((this.deadlineAt - Date.now()) / 1000)) : null;
    const role = s.landlord < 0 ? null : s.landlord === i ? this.pill("地主", "#e2741a") : this.pill("农民", "#3d8b2f");
    const box = v_flex().w(150).p(8).gap(4).rounded(6).relative().overflow_hidden()
      .border_1().border_color(turn ? "#ffd84a" : "#ffffff50")
      .child(div().absolute().top(0).left(0).size_full().bg(turn ? "#00000060" : "#00000040"))
      .child(h_flex().relative().gap(8).items_center().child(this.avatar(p, 40))
        .child(v_flex().min_w(0).child(div().truncate().text_color("#ffffff").child(p.name))
          .child(h_flex().gap(4).when(Boolean(role), (el) => el.child(role))
            .when(p.auto && !p.bot, (el) => el.child(this.pill("托管", "#6d6d6d")))
            .when(!p.online, (el) => el.child(this.pill("掉线", "#c42b1c"))))))
      .child(h_flex().relative().gap(6).items_center()
        .child(div().text_color("#ffe9a8").child(`筹码 ${p.tokens}`))
        .child(div().flex_1())
        .when(s.phase !== "lobby", (el) => el.child(h_flex().gap(3).items_center().child(this.back(TINY).w(16).h(22))
          .child(div().text_color("#ffffff").font_weight(700).child(String(p.cards)))))
        .when(secs != null, (el) => el.child(div().px(5).rounded(8).bg(secs <= 5 ? "#c42b1c" : "#1e395b").text_color("#ffffff").child(`${secs}`))));
    return v_flex().gap(10).items_center().when(align === "end", (el) => el.items_end()).when(align === "start", (el) => el.items_start())
      .child(box)
      .child(s.phase === "over" && s.reveal ? this.fan(s.reveal[i], TINY, { wild: s.wild }) : this.played(s, i, SMALL));
  }

  top(s) {
    const cards = s.bottom
      ? h_flex().gap(4).children(s.bottom.map((id) => this.card(id, SMALL, { wild: s.wild })))
      : h_flex().gap(4).children([0, 1, 2].map(() => this.back(SMALL)));
    return v_flex().items_center().gap(6)
      .child(cards)
      .child(h_flex().gap(8).items_center()
        .when(s.wild != null, (el) => el.child(this.pill(`赖子 ${rankLabel(s.wild)}`, "#f0b400")))
        .child(this.pill(`底分 ${s.base || "-"}`, "#00000060"))
        .child(this.pill(`倍数 ×${s.multiple}`, "#00000060"))
        .child(this.pill(`底注 ${s.config.ante}`, "#00000060")));
  }

  actions(s, mine, toast) {
    const row = h_flex().h(36).gap(10).items_center().justify_center();
    const me = s.seats[s.you];
    if (s.phase === "over") {
      const r = s.result;
      const win = (s.landlord === s.you) === r.landlordWins;
      return row.child(div().text_size(18).text_color(win ? "#ffe066" : "#ffffff").child(win ? "你赢了！" : "你输了"))
        .child(div().text_color("#ffffff").child(`${r.landlordWins ? "地主" : "农民"}胜利${r.spring ? " · 春天" : ""} · ${r.base} 分 × ${r.multiple} 倍 × 底注 ${r.ante}`))
        .child(div().text_color(r.delta[s.you] >= 0 ? "#ffe066" : "#ffb3a8").font_weight(700).child(`${r.delta[s.you] >= 0 ? "+" : ""}${r.delta[s.you]}`))
        .child(this.button("again", "再来一局", () => ddzSend({ t: "again" }), { primary: true }));
    }
    if (s.turn === s.you && !me?.auto) {
      if (s.phase === "bid") {
        row.child(this.button("b0", "不叫", () => ddzSend({ t: "bid", n: 0 })));
        for (const n of [1, 2, 3]) row.child(this.button(`b${n}`, `${n} 分`, () => ddzSend({ t: "bid", n }), { disabled: n <= s.bidTop, primary: n === 3 }));
      } else {
        const against = s.lead ? null : s.last?.combo ?? null;
        const chosen = [...this.sel].filter((id) => s.hand.includes(id));
        const c = chosen.length ? analyze(chosen, s.wild, against) : null;
        row.child(this.button("pass", "不出", () => { this.sel.clear(); ddzSend({ t: "pass" }); }, { disabled: s.lead }))
          .child(this.button("hint", "提示", () => {
            const opts = options(s.hand, against, s.wild);
            if (!opts.length) { this.sel.clear(); ddzSend({ t: "pass" }); return; }
            this.sel = new Set(opts[this.hint % opts.length]);
            this.hint++;
          }))
          .child(this.button("play", c ? `出牌 · ${c.type === "bomb" ? BOMB_NAMES[c.kind] : NAMES[c.type]}` : "出牌", () => {
            ddzSend({ t: "play", cards: chosen });
            this.sel.clear();
          }, { primary: true, disabled: !c, w: c ? 130 : 86 }));
      }
    } else if (s.turn >= 0) row.child(div().text_color("#ffffffc0").child(`等待 ${s.seats[s.turn]?.name ?? ""}…`));
    if (toast) row.child(div().px(8).py(2).rounded(4).bg("#c42b1ce0").text_color("#ffffff").child(toast));
    return row;
  }

  game(s) {
    const left = (s.you + 2) % 3, right = (s.you + 1) % 3;
    const d = ddz();
    const toast = d.toast && Date.now() - d.toast.at < 4000 ? d.toast.msg : null;
    const me = s.seats[s.you];
    const mine = s.turn === s.you;
    return v_flex().size_full().p(12).gap(6)
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(div().w(270).child(this.seatInfo(s, left, "start")))
        .child(v_flex().flex_1().items_center().gap(14)
          .child(this.top(s))
          .child(div().px(10).py(3).rounded(10).bg("#00000040").text_color("#ffffff").child(s.msg ?? "")))
        .child(div().w(270).flex().justify_end().child(this.seatInfo(s, right, "end"))))
      .child(h_flex().h(SMALL.h + 4).justify_center().child(this.played(s, s.you, SMALL)))
      .child(this.actions(s, mine, toast))
      .child(h_flex().gap(14).items_end().justify_center()
        .child(v_flex().w(150).gap(4).p(8).rounded(6).relative().overflow_hidden().border_1().border_color(mine ? "#ffd84a" : "#ffffff50")
          .child(div().absolute().top(0).left(0).size_full().bg(mine ? "#00000060" : "#00000040"))
          .child(h_flex().relative().gap(8).items_center().child(this.avatar(me, 40))
            .child(v_flex().min_w(0).child(div().truncate().text_color("#ffffff").child(me.name))
              .child(h_flex().gap(4)
                .when(s.landlord >= 0, (el) => el.child(s.landlord === s.you ? this.pill("地主", "#e2741a") : this.pill("农民", "#3d8b2f"))))))
          .child(div().relative().text_color("#ffe9a8").child(`筹码 ${me.tokens}`))
          .when(mine && this.deadlineAt != null && s.phase !== "over", (el) => el.child(div().relative().text_color("#ffffff")
            .child(`剩余 ${Math.max(0, Math.ceil((this.deadlineAt - Date.now()) / 1000))} 秒`))))
        .child(this.fan(s.hand, CARD, { wild: s.wild, sel: this.sel, lift: true, pick: (id) => {
          if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id);
          this.hint = 0;
        } }))
        .child(v_flex().w(110).gap(6)
          .when(s.phase !== "over", (el) => el.child(this.button("auto", me.auto ? "取消托管" : "托管", () => ddzSend({ t: "auto", on: !me.auto }), { primary: me.auto })))
          .child(this.button("reset", "重选", () => { this.sel.clear(); }, { disabled: !this.sel.size }))));
  }

  // ---- the window

  render(_cx) {
    const p = props() ?? {};
    const d = ddz();
    const s = d.status === "online" ? d.state : null;
    // A new turn: restart the clock, drop a stale selection.
    const key = s ? `${s.phase}:${s.moves}:${s.turn}` : null;
    if (key !== this.seen) {
      this.seen = key;
      this.deadlineAt = s?.deadline != null ? Date.now() + s.deadline : null;
      this.hint = 0;
      if (s) for (const id of [...this.sel]) if (!s.hand.includes(id)) this.sel.delete(id);
    }
    const max = Boolean(p.max);
    const front = active() === "game";
    const spot = windowSpot("game", max);
    const skey = spot ? `${spot.x},${spot.y}` : "";
    if (skey !== this.spotKey) { this.spotKey = skey; this.live = null; }
    const content = !s ? this.lobby(d) : s.phase === "lobby" ? this.room(s) : this.game(s);
    const menuItem = (id, text, items) => own(div().id(id)).px(8).h_full().flex().items_center().rounded(2).cursor_pointer()
      .text_color("#000000").hover((st) => st.bg("#ffffff60"))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); openMenu(items, { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y + 22 }, { width: 170 }); })
      .child(text);
    const gameItems = [
      { label: "再来一局(N)", act: { ddz: { t: "again" } }, disabled: !s || s.phase !== "over" },
      { label: s?.seats?.[s.you]?.auto ? "取消托管(T)" : "托管(T)", act: { ddz: { t: "auto", on: !s?.seats?.[s?.you]?.auto } }, disabled: !s || s.phase === "lobby" },
      { sep: true },
      { label: "离开房间(L)", act: { ddz: { t: "_leave" } }, disabled: !d.state },
      { label: "退出(X)", act: { ddz: { t: "_leave" }, closeGame: true } },
    ];
    const helpItems = [
      { label: "牌型：单张 对子 三带 顺子 连对 飞机 四带二", disabled: true },
      { label: "赖子可当 3～2 任意点数（不能当王）", disabled: true },
      { label: "软炸 < 硬炸 < 赖子炸 < 王炸", disabled: true },
      { label: "每回合 25 秒，超时两次自动托管", disabled: true },
    ];
    return v_flex().id("ddz").relative().size_full().font_family(FONT).text_size(13)
      .when(!max, (el) => el.rounded(7).shadow_lg()).overflow_hidden().border_1().border_color("#0c1726d8").bg("#b4cde6")
      .on_mouse_move((e, cx) => {
        const o = originOf(e);
        if (o && (!this.live || Math.abs(o.x - this.live.x) + Math.abs(o.y - this.live.y) > 0.5)) { this.live = o; cx.notify(); }
      })
      .on_mouse_down("left", () => raise("game"))
      .child(frost(this.live ?? spot, front ? GLASS : GLASS_DIM))
      .child(div().absolute().top(0).left(0).size_full().when(!max, (el) => el.rounded(6)).border_1().border_color("#ffffff90"))
      .child(h_flex().relative().h(28).flex_none().pl(8).gap(6).items_center()
        .child(icon("cards", 16))
        .child(div().px(6).rounded(9).bg(front ? "#ffffff42" : "#ffffff22").text_size(12).text_color("#000000").child("斗地主"))
        .child(captions(this, { id: "ddz-cap", max, front, onMin: () => minimizeGame(), onMax: () => openGame({ max: !max }), onClose: () => { ddzSend({ t: "_leave" }); closeGame(); } })))
      .child(own(v_flex().id("ddz-client")).relative().flex_1().min_h(0).mx(max ? 0 : 7).mb(max ? 0 : 7)
        .border_1().border_color("#3d5a3a")
        .on_mouse_down("left", (_e, cx) => { raise("game"); cx.stop_propagation(); })
        .child(h_flex().relative().h(22).flex_none().px(2).items_center().text_size(12)
          .child(fill("#f5f8fc", "#dfe8f3"))
          .child(menuItem("m-game", "游戏(G)", gameItems))
          .child(menuItem("m-help", "帮助(H)", helpItems)))
        .child(div().relative().flex_1().min_h(0).overflow_hidden()
          .child(fill("#2f8f3f", "#145a24"))
          .child(div().absolute().top(0).left(0).w_full().h(80).bg("#ffffff0c"))
          .child(div().relative().size_full().flex().items_center().justify_center().child(content))));
  }
}
