// Herdr 7: a Windows 7 Aero desktop, one mod in roles. The layout and the
// overlays give each copy props { role }:
//   desktop  the icons on the wallpaper
//   taskbar  the Start orb, program buttons, notification area, clock
//   title    a window's title bar (each terminal is a window)
//   edge     a window's side or bottom frame
//   start    the Start menu
//   explorer 计算机: spaces as drives, terminals as folders
//   menu     a context menu
//   dialog   the box asking before closing windows

import { View, div } from "gpui-kit";
import { props } from "herdr";
import Desktop from "./desktop.js";
import Taskbar from "./taskbar.js";
import TitleBar, { Edge } from "./frame.js";
import StartMenu from "./start.js";
import Explorer from "./explorer.js";
import Menu from "./menu.js";
import Dialog from "./dialog.js";

const ROLES = { desktop: Desktop, taskbar: Taskbar, title: TitleBar, edge: Edge, start: StartMenu, explorer: Explorer, menu: Menu, dialog: Dialog };

export default class Win7 extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    const R = ROLES[pr.role];
    this.role = R ? new R() : null;
    this.role?.init?.(pr, cx);
  }

  render(cx) {
    if (!this.role) return div().child(`win7: no role "${props()?.role}"`);
    return this.role.render(cx);
  }

  async close(cx) {
    this.role?.close?.(cx);
  }
}
