// The preview cache's entries and which of them to delete. An entry is named <hash of the file's path>-<mtime>-<size>,
// with the image's extension or as a PDF's folder.
export const CACHE_LIMIT_KB = 256 * 1024;

function hash(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

// `stamp` is the file's "<mtime>-<size>".
export const entryName = (file, stamp) => `${hash(file)}-${stamp}`;

const pathKey = name => name.slice(0, name.indexOf("-"));

// `entries` are { name, kb, mtime }; `current` was just written; `keep` holds the entries open in a tab.
export function toRemove(entries, current, keep, limitKb) {
    const stays = e => e.name === current || keep.has(e.name);
    const stale = entries.filter(e => !stays(e) && pathKey(e.name) === pathKey(current));
    const rest = entries.filter(e => !stale.includes(e));
    let kb = rest.reduce((sum, e) => sum + e.kb, 0);
    const evicted = [];
    for (const e of rest.filter(e => !stays(e)).sort((a, b) => a.mtime - b.mtime)) {
        if (kb <= limitKb) break;
        evicted.push(e);
        kb -= e.kb;
    }
    return [...stale, ...evicted].map(e => e.name);
}

// The previews open in the given Herdr tabs, from the state each editor pane saves under herdr-ide:<tab>.
export function inUse(storage, tabs) {
    const names = new Set();
    for (const tab of tabs) {
        try {
            for (const f of JSON.parse(storage.getItem(`herdr-ide:${tab}`) ?? "null")?.files ?? []) if (f.entry) names.add(f.entry);
        } catch {}
    }
    return names;
}

// Entries from `du -sk` and `stat -f "%m<tab>%N"` run as `find . -mindepth 1 -maxdepth 1 -exec … {} +`; anything not named like an entry is left out.
export function entriesFrom(du, stat) {
    const rows = text => text.split("\n").filter(Boolean).map(line => line.split("\t")).map(([n, path]) => [path.replace(/^\.\//, ""), Number(n)]);
    const mtimes = new Map(rows(stat));
    return rows(du).filter(([name]) => /^[0-9a-z]+-\d+-\d+(\.\w+)?$/.test(name) && mtimes.has(name))
        .map(([name, kb]) => ({ name, kb, mtime: mtimes.get(name) }));
}
