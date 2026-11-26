import { test, expect } from "bun:test";
import { toRemove, inUse, entriesFrom, CACHE_LIMIT_KB } from "../mods/herdr-ide/cache.js";

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

test("previews open in a tab are never removed, stale or over the limit", () => {
    const entries = [entry("abc-100-5", 60, 1), entry("old-1-1", 60, 2), entry("abc-300-7", 60, 3)];
    expect(toRemove(entries, "abc-300-7", new Set(["abc-100-5", "old-1-1"]), 100)).toEqual([]);
});

test("the entry just written stays even when it alone is over the limit", () => {
    expect(toRemove([entry("big-1-1", 500, 1)], "big-1-1", new Set(), 100)).toEqual([]);
});

test("open previews are those of the given tabs only", () => {
    const previews = { t1: { "/a.pdf": "abc-1-1" }, t2: { "/c.png": "def-1-1.png" }, closed: { "/d.pdf": "zzz-1-1" } };
    expect([...inUse(previews, ["t1", "t2", "t3"])].sort()).toEqual(["abc-1-1", "def-1-1.png"]);
    expect([...inUse(undefined, ["t1"])]).toEqual([]);
});

test("entries are read from du and stat output, skipping files the cache did not name", () => {
    const du = "7404\t./pq2hdm-1795602223-252822\n0\t./.DS_Store\n0\t./g9ge9v-1795017852-718262.png\n";
    const stat = "1795688533\t./pq2hdm-1795602223-252822\n1795689987\t./.DS_Store\n1795688532\t./g9ge9v-1795017852-718262.png\n";
    expect(entriesFrom(du, stat)).toEqual([
        { name: "pq2hdm-1795602223-252822", kb: 7404, mtime: 1795688533 },
        { name: "g9ge9v-1795017852-718262.png", kb: 0, mtime: 1795688532 },
    ]);
});
