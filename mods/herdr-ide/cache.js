// Which preview cache entries to delete. An entry is named <hash of the file's path>-<mtime>-<size>, with the image's extension or as a PDF's folder.
export const CACHE_LIMIT_KB = 256 * 1024;

const fileOf = name => name.slice(0, name.indexOf("-"));

// `entries` are { name, kb, mtime }; `current` was just written; `keep` holds the entries open in a tab.
export function toRemove(entries, current, keep, limitKb) {
    const stays = e => e.name === current || keep.has(e.name);
    const stale = entries.filter(e => !stays(e) && fileOf(e.name) === fileOf(current));
    const rest = entries.filter(e => !stale.includes(e));
    let kb = rest.reduce((sum, e) => sum + e.kb, 0);
    const old = [];
    for (const e of rest.filter(e => !stays(e)).sort((a, b) => a.mtime - b.mtime)) {
        if (kb <= limitKb) break;
        old.push(e);
        kb -= e.kb;
    }
    return [...stale, ...old].map(e => e.name);
}

// The previews every editor pane has open, from the state each saves per Herdr tab under herdr-ide:<tab>.
export function inUse(storage) {
    const names = new Set();
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith("herdr-ide:")) continue;
        try {
            for (const f of JSON.parse(storage.getItem(key) ?? "null")?.files ?? []) if (f.preview) names.add(f.preview);
        } catch {}
    }
    return names;
}
