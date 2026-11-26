// Opens a file in the active tab's editor pane, splitting one off only when the tab has none.
import { panes, focused, run, setShared } from "herdr";

// The mod's folder name: pane.split and openOverlay address the mod by it, so a renamed install changes it here.
export const MOD = "herdr-ide";
export const OPEN = `${MOD}.open`;
// The previews each tab's editor pane shows, { [tab]: { [file]: cache entry } }; localStorage would not do, since it is scoped by props.
export const PREVIEWS = `${MOD}.previews`;

// `line` is 1-based; `find` is selected on that line when given.
export function openInEditor(file, on = null, line = null, find = null) {
    const tab = focused()?.tab ?? null;
    const pane = panes().find(p => p.mod === MOD && p.tab === tab);
    if (!pane) return run("pane.split", { direction: "right", mod: MOD, props: { role: "editor", tab, file, on, line, find } });
    setShared(OPEN, { tab, file, on, line, find, seq: Date.now() });
    run("pane.focus", { pane: pane.pane });
}
