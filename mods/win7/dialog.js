// The Win7 message box asking before windows (their terminals) are closed.

import { div } from "gpui-kit";
import { GLASS } from "./frame.js";
import { h_flex, v_flex } from "gpui-base";
import { props, run, shared, closeOverlay } from "herdr";
import { DESK, TASKBAR, frost, glossy, own, icon, terms, title, FONT } from "./kit.js";

export default class Dialog {
  init() {
    this.hot = null;
  }

  button(id, text, primary, onClick) {
    const hot = this.hot === id;
    const face = hot ? ["#eaf6fd", "#d9f0fc", "#bee6fd", "#a7d9f5"] : ["#f2f2f2", "#ebebeb", "#dddddd", "#cfcfcf"];
    return own(div().id(id)).relative().w(86).h(25).rounded(3).overflow_hidden().cursor_pointer()
      .border_1().border_color(hot ? "#3c7fb1" : primary ? "#3399ff" : "#707070")
      .on_hover((on, cx) => { this.hot = on ? id : null; cx.notify(); })
      .on_click((_e, cx) => { onClick(); cx.notify(); })
      .child(glossy(...face))
      .child(div().absolute().top(0).left(0).size_full().rounded(2).border_1().border_color(primary && !hot ? "#bfe6ff" : "#ffffffb0"))
      .child(div().relative().size_full().flex().items_center().justify_center().text_color("#000000").child(text));
  }

  render(_cx) {
    const p = props() ?? {};
    const ts = p.terminals ?? [];
    const list = terms().filter((x) => ts.includes(x.terminal));
    const done = () => closeOverlay(p.overlay);
    const desk = shared(DESK);
    const ask = list.length === 1 ? `确实要关闭“${title(list[0])}”吗？` : `确实要关闭这 ${list.length} 个窗口吗？`;
    return v_flex().size_full().relative().font_family(FONT).text_size(12)
      .rounded(7).overflow_hidden().border_1().border_color("#101c2bd0").shadow_lg()
      .child(frost(desk ? { x: (desk.w - 400) / 2, y: (desk.h + TASKBAR - 178) / 2 } : null, GLASS))
      .child(div().absolute().top(0).left(0).size_full().rounded(6).border_1().border_color("#ffffffa0"))
      .child(h_flex().relative().h(30).flex_none().items_center().pl(10)
        .child(div().px(6).rounded(9).bg("#ffffff42").text_color("#000000").child("关闭窗口"))
        .child(div().flex_1())
        .child(own(div().id("dlg-x")).relative().self_start().mr(6).w(43).h(19).rounded_b(4).overflow_hidden().cursor_pointer()
          .border_1().border_t(0).border_color("#1c2c42d8")
          .on_click(() => done())
          .child(glossy("#eab3a5", "#d88472", "#c4472c", "#d9806a"))
          .child(div().relative().size_full().flex().items_center().justify_center().child(icon("ctl-close", 16, 13)))))
      .child(v_flex().relative().flex_1().mx(7).mb(7).bg("#ffffff").border_1().border_color("#7f9db9")
        .child(h_flex().flex_1().px(14).gap(14).items_center()
          .child(icon("warn", 36))
          .child(v_flex().gap(6).min_w(0)
            .child(div().text_size(14).text_color("#003399").truncate().child(ask))
            .child(div().text_color("#333333").child("窗口中正在运行的程序将被结束。"))))
        .child(h_flex().h(44).flex_none().px(12).gap(8).justify_end().items_center().bg("#f0f0f0").border_t(1).border_color("#dfdfdf")
          .child(this.button("dlg-ok", "关闭", true, () => {
            for (const x of list) run("pane.close", { pane: x.pane });
            done();
          }))
          .child(this.button("dlg-cancel", "取消", false, done))));
  }
}
