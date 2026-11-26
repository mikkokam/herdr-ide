import { test, expect } from "bun:test";
import { toRemove, inUse, CACHE_LIMIT_KB } from "../mods/herdr-ide/cache.js";

const entry = (name, kb, mtime) => ({ name, kb, mtime });

test("a changed file's older previews are removed once the new one is written", () => {
    const entries = [entry("abc-100-5", 10, 100), entry("abc-200-6.png", 1, 200), entry("abc-300-7", 10, 300), entry("xyz-100-5", 10, 100)];
    expect(toRemove(entries, "abc-300-7", new Set(), CACHE_LIMIT_KB).sort()).toEqual(["abc-100-5", "abc-200-6.png"]);
});

test("the cache is cut to the limit, oldest first", () => {
    const entries = [entry("c-1-1", 40, 3), entry("a-1-1", 40, 1), entry("b-1-1", 40, 2), entry("d-1-1", 40, 4)];
    const gone = toRemove(entries, "d-1-1", new Set(), 100);
    expect(gone).toEqual(["a-1-1", "b-1-1"]);
    expect(entries.filter(e => !gone.includes(e.name)).reduce((kb, e) => kb + e.kb, 0)).toBeLessThanOrEqual(100);
});

test("the limit is 256 MB", () => {
    expect(CACHE_LIMIT_KB).toBe(256 * 1024);
});

test("previews open in a tab are never removed, stale or over the limit", () => {
    const entries = [entry("abc-100-5", 60, 1), entry("old-1-1", 60, 2), entry("abc-300-7", 60, 3)];
    expect(toRemove(entries, "abc-300-7", new Set(["abc-100-5", "old-1-1"]), 100)).toEqual([]);
});

test("the entry just written stays even when it alone is over the limit", () => {
    expect(toRemove([entry("big-1-1", 500, 1)], "big-1-1", new Set(), 100)).toEqual([]);
});

test("open previews are read from every tab's saved state", () => {
    const data = {
        "herdr-ide:t1": JSON.stringify({ files: [{ file: "/a.pdf", preview: "abc-1-1" }, { file: "/b.js" }], active: 0 }),
        "herdr-ide:t2": JSON.stringify({ files: [{ file: "/c.png", preview: "def-1-1.png" }], active: 0 }),
        "herdr-ide:t3": "not json",
        "other": JSON.stringify({ files: [{ preview: "zzz-1-1" }] }),
    };
    const keys = Object.keys(data);
    const storage = { length: keys.length, key: i => keys[i] ?? null, getItem: k => data[k] ?? null };
    expect([...inUse(storage)].sort()).toEqual(["abc-1-1", "def-1-1.png"]);
});
