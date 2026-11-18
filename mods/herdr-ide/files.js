// Role "files": a lazy file tree for the focused terminal's folder, with project search. A click opens the file in the editor role.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, window, openOverlay } from "herdr";
import { MOD, openInEditor } from "./open.js";
import { menuHeight } from "./menu.js";

// A focused mod pane (the editor) has no folder, so the tree stays on the last terminal's, or the tab's first terminal's.
let last = null;
function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  if (pane?.mod) {
    if (last?.space === space?.id) return last;
    const terminal = panes().find(p => p.tab === f.tab && !p.mod && p.cwd);
    if (terminal) return last = { cwd: terminal.cwd, on: space?.machine ?? null, space: space?.id };
  }
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return last = { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const PER_FOLDER = 500, TOTAL = 5000, HITS = 1000;

// Fixed-string, smart-case search under root: ripgrep when the machine has it (it honours .gitignore), else grep.
async function search(root, on, query) {
  const rg = await exec("rg", ["--line-number", "--no-heading", "--color", "never", "--smart-case", "--fixed-strings", "--max-columns", "300", "--max-columns-preview", "--max-count", "50", "-e", query, "--", "."], { cwd: root, on, timeout: 15000 }).catch(() => null);
  const r = rg && rg.code <= 1 ? rg : await exec("grep", ["-rnIF", ...(query === query.toLowerCase() ? ["-i"] : []), "--exclude-dir=.git", "--exclude-dir=node_modules", "-e", query, "--", "."], { cwd: root, on, timeout: 15000 });
  if (r.code > 1) throw new Error(r.stderr || "Search failed");
  const files = new Map();
  let count = 0;
  for (const row of r.stdout.split("\n")) {
    const m = /^(.*?):(\d+):(.*)$/.exec(row);
    if (!m) continue;
    if (++count > HITS) break;
    const path = m[1].replace(/^\.\//, "");
    if (!files.has(path)) files.set(path, []);
    files.get(path).push({ line: Number(m[2]), text: m[3].trim() });
  }
  return { files: [...files.entries()], limited: count > HITS };
}

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export class Files {
  init(_props, cx) {
    this.query = InputState.new({ placeholder: "Search in files" });
    this.query.on("change", (_e, cx) => this.search(cx));
    this.found = null; this.searchSeq = 0;
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, this.folders);
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved);
      this.pending = new Set(); this.marks = {}; this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (this.query.value()) this.search(cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }


  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : openInEditor(`${this.root}/${path}`, this.on))
        .when(!this.on, el => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: MOD, kind: "popup", width: 220, height: menuHeight(entry.dir), props: { role: "menu", path: `${this.root}/${path}`, root: this.root, dir: entry.dir } }); }))
        .child(entry.dir ? svg(`mods/${MOD}/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/${MOD}/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  // Debounced: only the newest query's results are kept.
  search(cx) {
    const query = this.query.value(), seq = ++this.searchSeq, root = this.root, on = this.on;
    if (!query || !root) { this.found = null; return cx.notify(); }
    this.found = { ...(this.found ?? { files: [] }), busy: true };
    cx.notify();
    cx.timer.after(200, async cx => {
      if (seq !== this.searchSeq) return;
      try { const r = await search(root, on, query); if (seq === this.searchSeq) this.found = { ...r, query }; }
      catch (e) { if (seq === this.searchSeq) this.found = { files: [], error: String(e), query }; }
      cx.notify();
    });
  }

  hits(t) {
    const f = this.found, out = [];
    for (const [path, lines] of f.files) {
      out.push(h_flex().id(`hit-${path}`).h(26).flex_none().px(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click(() => openInEditor(`${this.root}/${path}`, this.on, lines[0].line, f.query))
        .child(svg(`mods/${MOD}/file.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(path))
        .child(div().text_size(11).text_color(t.dim).child(String(lines.length))));
      for (const { line, text } of lines) out.push(h_flex().id(`hit-${path}:${line}`).h(24).flex_none().pl(29).pr(8).gap(8).items_center().rounded(7).cursor_pointer().text_size(12).hover(s => s.bg(t.hover))
        .on_click(() => openInEditor(`${this.root}/${path}`, this.on, line, f.query))
        .child(div().w(34).flex_none().text_right().text_color(t.dim).child(String(line)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(text)));
    }
    const note = f.error ?? (f.busy && !f.files.length ? "Searching…" : !f.files.length ? "No results" : f.limited ? `Showing the first ${HITS} matches` : null);
    if (note) out.push(div().p(8).text_size(12).text_color(t.dim).child(note));
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.root?.split(/[\\/]/).pop() ?? "")))
      .child(h_flex().h(40).flex_none().px(8).items_center().border_b(1).border_color(t.border)
        .on_key_down((e, cx) => { if (e.keystroke === "escape") { this.query.set_value(""); this.search(cx); cx.stop_propagation(); } })
        .child(h_flex().flex_1().h(28).px(8).rounded(7).items_center().border_1().border_color(t.border).bg(t.input ?? t.surface).child(Input.new(this.query).flex_1())))
      .when(Boolean(this.found), el => el.child(v_flex().id("files-hits").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.hits(t))))
      .when(!this.found, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))));
  }
}

