// Role "editor": a tabbed editor for one Herdr tab. Created with props {tab, file, on, line, find};
// later files arrive through shared(OPEN). Files on another machine open read-only, because writeTextFile writes only on this computer.
import { div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input, TextView } from "gpui-base";
import { props, shared, nextCommand, readTextFile, writeTextFile, watchFolder, theme, settings, home, checking } from "herdr";
import { OPEN } from "./open.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html", md: "markdown", mdx: "markdown" };
const MARKDOWN = new Set(["md", "mdx", "markdown"]);

const basename = file => file.slice(file.lastIndexOf("/") + 1);

// Smart case, as in ripgrep: a query with a capital letter matches case.
function matches(text, query) {
    if (!query) return [];
    const exact = query !== query.toLowerCase(), hay = exact ? text : text.toLowerCase(), needle = exact ? query : query.toLowerCase();
    const out = [];
    for (let i = hay.indexOf(needle); i !== -1 && out.length < 10000; i = hay.indexOf(needle, i + needle.length)) out.push(i);
    return out;
}

export class EditorPane {
    init(initial, cx) {
        const p = initial ?? props() ?? {};
        this.tab = p.tab ?? null;
        this.buffers = [];
        this.active = null;
        this.finder = null;
        this.seen = shared(OPEN)?.seq ?? null;
        const saved = this.saved();
        for (const f of saved?.files ?? []) this.open(f.file, f.on ?? null, cx, { select: false });
        this.select(this.buffers[saved?.active] ?? this.buffers[0] ?? null);
        if (p.file) this.open(p.file, p.on ?? null, cx, { line: p.line, find: p.find });
        // `herdr-app do herdr-ide.open:<path>[:<line>]` opens a local file in the shown editor, for scripts and agents.
        if (!checking()) cx.spawn(async cx => {
            for (;;) {
                const c = await nextCommand();
                const m = /^open:(.+?)(?::(\d+))?$/.exec(c);
                if (m) { this.open(m[1], null, cx, { line: m[2] ? Number(m[2]) : null }); cx.notify(); }
            }
        });
    }

    storageKey() {
        return `herdr-ide:${this.tab}`;
    }

    saved() {
        try { return JSON.parse(localStorage.getItem(this.storageKey()) ?? "null"); } catch { return null; }
    }

    persist() {
        if (checking()) return;
        const files = this.buffers.map(b => ({ file: b.file, on: b.on }));
        try { localStorage.setItem(this.storageKey(), JSON.stringify({ files, active: this.buffers.indexOf(this.active) })); } catch {}
    }

    open(file, on, cx, { select = true, line = null, find = null } = {}) {
        let b = this.buffers.find(x => x.file === file && x.on === on);
        if (!b) {
            const name = basename(file);
            b = { file, on, ext: name.includes(".") ? name.split(".").pop().toLowerCase() : "", code: null, base: null, error: null, conflict: false, preview: false, closing: false, goto: null };
            this.buffers.push(b);
            this.load(b, cx);
            if (!on && !checking()) this.watch(b, cx);
        }
        if (select) this.select(b);
        if (line) this.goto(b, line, find);
        this.persist();
    }

    // Selects `find` on 1-based `line`, or puts the cursor at the line's start; waits for the file to load.
    goto(b, line, find) {
        if (!b.code) { b.goto = { line, find }; return; }
        b.goto = null;
        b.preview = false;
        const text = b.code.value();
        let start = 0;
        for (let n = 1; n < line; n++) {
            const next = text.indexOf("\n", start);
            if (next === -1) break;
            start = next + 1;
        }
        const end = text.indexOf("\n", start) === -1 ? text.length : text.indexOf("\n", start);
        const hit = find ? matches(text.slice(start, end), find)[0] : undefined;
        b.code.set_selected_range(hit === undefined ? { start, end: start } : { start: start + hit, end: start + hit + find.length });
        if (b === this.active) b.code.focus();
    }

    select(b) {
        this.active = b;
        if (b && !b.preview) b.code?.focus();
        if (this.finder) this.find(0);
    }

    close(b, cx) {
        if (this.dirty(b) && !b.closing) {
            b.closing = true;
            b.error = "Unsaved changes. Close the tab again to discard them.";
            this.select(b);
            return cx.notify();
        }
        const i = this.buffers.indexOf(b);
        this.buffers.splice(i, 1);
        b.code?.release();
        if (this.active === b) this.select(this.buffers[Math.min(i, this.buffers.length - 1)] ?? null);
        this.persist();
        cx.notify();
    }

    load(b, cx) {
        cx.spawn(async cx => {
            try {
                const text = await readTextFile(b.file, { on: b.on });
                if (!this.buffers.includes(b)) return;
                if (text !== null && text.includes("\0")) { b.error = "Binary file"; return; }
                b.base = text;
                const t = theme();
                b.code?.release();
                b.code = EditorState.new({ language: LANG[b.ext] ?? b.ext, value: text ?? "", readonly: Boolean(b.on),
                    font_family: settings().font_family, font_size: 13, soft_wrap: MARKDOWN.has(b.ext),
                    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
                b.code.on("change", (_e, cx) => { b.closing = false; cx.notify(); });
                b.error = null; b.conflict = false;
                if (b.goto) this.goto(b, b.goto.line, b.goto.find);
                else if (b === this.active) b.code.focus();
            } catch (e) { b.error = `Cannot open: ${e}`; }
            finally { cx.notify(); }
        });
    }

    dirty(b) {
        return Boolean(b?.code) && b.code.value() !== (b.base ?? "");
    }

    // A change on disk reloads a clean buffer; a dirty one is left alone and the save reports the conflict.
    watch(b, cx) {
        const dir = b.file.slice(0, b.file.lastIndexOf("/")) || "/";
        cx.spawn(async cx => {
            while (this.buffers.includes(b)) {
                await watchFolder(dir);
                if (!this.buffers.includes(b)) return;
                const text = await readTextFile(b.file).catch(() => undefined);
                if (text === undefined || text === b.base) continue;
                if (!this.dirty(b) && text !== null) { b.base = text; b.code?.set_value(text); }
                else b.conflict = true;
                cx.notify();
            }
        });
    }

    save(b, cx) {
        if (!b?.code || b.on || !this.dirty(b)) return;
        const text = b.code.value();
        cx.spawn(async cx => {
            try { await writeTextFile(b.file, text, b.base); b.base = text; b.conflict = false; b.closing = false; b.error = null; }
            catch { b.conflict = true; b.error = "Changed on disk since it was opened. Reload discards your edits."; }
            finally { cx.notify(); }
        });
    }

    openFinder() {
        const code = this.active?.code;
        if (!code) return;
        const { start, end } = code.selected_range(), picked = code.value().slice(start, end);
        if (!this.finder) {
            const state = InputState.new({ placeholder: "Find" });
            state.on("change", (_e, cx) => { this.find(0); cx.notify(); });
            state.on("submit", (_e, cx) => { if (this.finder.skipSubmit) this.finder.skipSubmit = false; else this.find(1); cx.notify(); });
            this.finder = { state, hits: [], at: -1, skipSubmit: false };
        }
        if (picked && !picked.includes("\n")) this.finder.state.set_value(picked);
        this.finder.state.focus();
        this.find(0);
    }

    closeFinder() {
        this.finder?.state.release?.();
        this.finder = null;
        this.active?.code?.focus();
    }

    // step 0 picks the first hit at or after the cursor; 1 and -1 move to the next or previous, wrapping.
    find(step) {
        const f = this.finder, code = this.active?.code;
        if (!f) return;
        const query = f.state.value();
        f.hits = code ? matches(code.value(), query) : [];
        if (!f.hits.length) { f.at = -1; return; }
        const cursor = code.selected_range().start;
        const next = f.hits.findIndex(h => h >= cursor);
        if (step === 0 || f.at < 0) f.at = next === -1 ? 0 : next;
        else f.at = (f.at + step + f.hits.length) % f.hits.length;
        code.set_selected_range({ start: f.hits[f.at], end: f.hits[f.at] + query.length });
    }

    keys(e, cx) {
        const b = this.active, k = e.keystroke;
        // Shift-Enter may or may not also fire the input's submit; a later plain Enter must not be swallowed.
        if (this.finder && k !== "shift-enter") this.finder.skipSubmit = false;
        if (k === "cmd-s") this.save(b, cx);
        else if (k === "cmd-f") this.openFinder();
        else if (k === "cmd-g" && this.finder) this.find(1);
        else if (k === "cmd-shift-g" && this.finder) this.find(-1);
        else if (k === "shift-enter" && this.finder) { this.finder.skipSubmit = true; this.find(-1); }
        else if (k === "escape" && this.finder) this.closeFinder();
        else return;
        cx.stop_propagation();
        cx.notify();
    }

    button(t, id, label, onClick) {
        return div().id(id).px(8).py(2).rounded(5).text_size(12).text_color(t.muted).cursor_pointer()
            .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(onClick).child(label);
    }

    tabs(t) {
        return h_flex().id("editor-tabs").h(34).flex_none().items_end().overflow_x_scrollbar().bg(t.surface).border_b(1).border_color(t.border)
            .children(this.buffers.map((b, i) => {
                const on = b === this.active, same = this.buffers.some(x => x !== b && basename(x.file) === basename(b.file));
                const parent = b.file.slice(0, b.file.lastIndexOf("/"));
                return h_flex().id(`editor-tab-${i}`).h_full().flex_none().pl(12).pr(6).gap(6).items_center().border_r(1).border_color(t.border).cursor_pointer()
                    .bg(on ? t.background : t.surface).text_color(on ? t.foreground : t.muted).hover(s => s.text_color(t.foreground))
                    .on_click((_e, cx) => { this.select(b); this.persist(); cx.notify(); })
                    .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); this.close(b, cx); })
                    .child(div().text_size(12).child(basename(b.file)))
                    .when(same, el => el.child(div().text_size(11).text_color(t.dim).child(basename(parent))))
                    .child(h_flex().id(`editor-close-${i}`).w(18).h(18).rounded(4).items_center().justify_center().text_size(11)
                        .text_color(this.dirty(b) ? t.foreground : t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
                        .on_click((_e, cx) => { cx.stop_propagation(); this.close(b, cx); })
                        .child(this.dirty(b) ? "●" : "×"));
            }));
    }

    finderBar(t) {
        const f = this.finder, count = !f.state.value() ? "" : f.hits.length ? `${f.at + 1} of ${f.hits.length}` : "No results";
        return h_flex().h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
            .child(h_flex().flex_1().h(26).px(8).rounded(6).items_center().border_1().border_color(t.border).bg(t.input ?? t.surface)
                .child(Input.new(f.state).flex_1()))
            .child(div().w(76).text_right().text_size(11).text_color(t.dim).child(count))
            .child(this.button(t, "find-prev", "↑", (_e, cx) => { this.find(-1); cx.notify(); }))
            .child(this.button(t, "find-next", "↓", (_e, cx) => { this.find(1); cx.notify(); }))
            .child(this.button(t, "find-close", "×", (_e, cx) => { this.closeFinder(); cx.notify(); }));
    }

    render(cx) {
        const request = shared(OPEN);
        if (request && request.seq !== this.seen) {
            this.seen = request.seq;
            if (request.tab === this.tab) this.open(request.file, request.on ?? null, cx, { line: request.line, find: request.find });
        }
        const t = theme(), b = this.active;
        const root = v_flex().id("editor").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13);
        if (!b) return root.child(div().p(16).text_color(t.dim).child("Click a file in the Files panel to open it here."));
        const where = b.file.replace(home(), "~");
        const md = MARKDOWN.has(b.ext);
        return root
            .on_key_down((e, cx) => this.keys(e, cx))
            .child(this.tabs(t))
            .child(h_flex().h(28).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
                .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(b.on ? `${b.on}:${where}` : where))
                .when(Boolean(b.on), el => el.child(div().text_size(11).text_color(t.dim).child("read-only")))
                .when(b.conflict, el => el.child(this.button(t, "reload", "Reload", (_e, cx) => this.load(b, cx))))
                .when(md, el => el.child(this.button(t, "mode", b.preview ? "Edit" : "Preview", (_e, cx) => {
                    b.preview = !b.preview;
                    if (!b.preview) b.code?.focus();
                    cx.notify();
                })))
                .when(this.dirty(b) && !b.on, el => el.child(this.button(t, "save", "Save", (_e, cx) => this.save(b, cx)))))
            .when(Boolean(this.finder), el => el.child(this.finderBar(t)))
            .when(Boolean(b.error), el => el.child(div().px(12).py(6).text_size(12).text_color(t.ansi1).child(b.error)))
            .child(!b.code ? div().p(12).text_color(t.dim).child(b.error ? "" : "Loading…")
                : b.preview ? div().flex_1().min_h(0).px(20).py(16).child(TextView.markdown(`preview-${this.buffers.indexOf(b)}`, b.code.value()).scrollable(true).selectable(true).size_full())
                : Editor.new(b.code).flex_1().min_h(0));
    }
}
