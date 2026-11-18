// herdr-ide: one mod in three roles. The layout shows role "files", the tree's clicks split off role "editor",
// and its right-click opens role "menu" as a popup.
import { View } from "gpui-kit";
import { props } from "herdr";
import { Files } from "./files.js";
import { EditorPane } from "./editor.js";
import { FilesMenu } from "./menu.js";

const ROLES = { files: Files, editor: EditorPane, menu: FilesMenu };

export default class Ide extends View {
    init(p, cx) {
        const role = (p ?? props())?.role;
        this.view = new (ROLES[role] ?? Files)();
        this.view.init(p, cx);
    }

    render(cx) {
        return this.view.render(cx);
    }
}
