// A Win7 context menu (the window menu, jump lists, Shut down's arrow):
// light face, the icon gutter with its etched line, a soft blue highlight.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay } from "herdr";
import { fill, own, icon, perform, transient, FONT } from "./kit.js";

export default class Menu {
  init() {
    this.hot = -1;
  }

  render(_cx) {
    const p = props() ?? {};
    const items = p.items ?? [];
    const list = v_flex().relative().p(2).gap(0);
    items.forEach((it, i) => {
      if (it.sep) {
        list.child(div().h(7).flex().flex_col().justify_center().pl(30)
          .child(div().h(1).bg("#e0e0e0")).child(div().h(1).bg("#ffffff")));
        return;
      }
      const hot = this.hot === i && !it.disabled;
      list.child(own(h_flex().id(`mi-${i}`)).relative().h(24).items_center().rounded(3)
        .border_1().border_color(hot ? "#a8d8eb" : "#00000000")
        .on_hover((on, cx) => { this.hot = on ? i : this.hot === i ? -1 : this.hot; cx.notify(); })
        .on_click((_e, cx) => {
          if (it.disabled) return;
          closeOverlay(p.overlay);
          perform(it.act);
          cx.notify();
        })
        .when(hot, (el) => el.child(div().absolute().top(0).left(0).size_full().rounded(2).overflow_hidden().child(fill("#f1f8fd", "#d5ebf8"))))
        .child(div().relative().w(26).flex_none().flex().justify_center().when(Boolean(it.icon), (el) => el.child(icon(it.icon, 16))))
        .child(div().relative().flex_1().pl(6).text_color(it.disabled ? "#8d8d8d" : "#000000").when(Boolean(it.bold), (el) => el.font_weight(700)).child(it.label))
        .when(Boolean(it.hint), (el) => el.child(div().relative().pr(12).text_color("#6d6d6d").child(it.hint))));
    });
    return transient(div(), p.overlay).size_full().relative().font_family(FONT).text_size(12)
      .bg("#f0f0f0").border_1().border_color("#979797").shadow_md()
      .child(div().absolute().top(2).bottom(2).left(29).w(1).bg("#e2e3e3"))
      .child(div().absolute().top(2).bottom(2).left(30).w(1).bg("#ffffff"))
      .child(list);
  }
}
