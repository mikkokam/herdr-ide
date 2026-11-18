// The right-click menu on a tree row (role "menu"), styled after Herdr's `menu`. Props { path, root, dir, overlay }.
// Groups run open, reveal, copy, as in Zed and VS Code. ↑/↓ move, Enter runs, Esc closes.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, props, closeOverlay, theme } from "herdr";
import { openInEditor } from "./open.js";

const ROW = 31, RULE = 9, PAD = 10;

function groups({ path, root, dir } = {}) {
    const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    return [
        dir ? [["Open in Zed", () => exec("open", ["-a", "Zed", path])]]
            : [["Open", () => openInEditor(path)],
               ["Open in Zed", () => exec("open", ["-a", "Zed", path])],
               ["Open with default app", () => exec("open", [path])]],
        [["Reveal in Finder", () => exec("open", ["-R", path])]],
        [["Copy path", cx => cx.write_to_clipboard(path)],
         ["Copy relative path", cx => cx.write_to_clipboard(relative)]],
    ];
}

export function menuHeight(dir) {
    const g = groups({ path: "", dir });
    return PAD + ROW * g.flat().length + RULE * (g.length - 1);
}

export class FilesMenu {
    init(_props, cx) {
        this.at = 0;
        this.handle = cx.focus_handle();
        this.handle.focus();
    }

    choose(i, cx) {
        const it = groups(props() ?? undefined).flat()[i];
        closeOverlay(props().overlay);
        it?.[1](cx);
    }

    render() {
        const t = theme(), g = groups(props() ?? undefined), count = g.flat().length;
        let i = 0;
        return v_flex().id("files-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
            .on_key_down((e, cx) => {
                if (e.key === "down") this.at = (this.at + 1) % count;
                else if (e.key === "up") this.at = (this.at + count - 1) % count;
                else if (e.key === "enter") return this.choose(this.at, cx);
                else if (e.key === "escape") return closeOverlay(props().overlay);
                else return;
                cx.notify();
            })
            .children(g.flatMap((items, n) => [
                ...(n ? [div().h(1).my(4).mx(4).flex_none().bg(t.border)] : []),
                ...items.map(([label]) => {
                    const at = i++;
                    return h_flex().id(`fm-${at}`).h(ROW).flex_none().px(8).rounded(7).items_center().text_color(t.foreground)
                        .when(at === this.at, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
                        .on_click((_e, cx) => this.choose(at, cx)).child(div().flex_1().child(label));
                }),
            ]));
    }
}
