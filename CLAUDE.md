# herdr-ide

A Herdr desktop mod: file tree with project search, and a tabbed editor pane. `RECIPE.md` is the spec an installing agent follows and the catalogue shows; keep it true to the code.

## Commands

```sh
rsync -a --delete mods/herdr-ide/ ~/.config/herdr-app/mods/herdr-ide/   # install this checkout; Herdr reloads on change
herdr-app check ~/.config/herdr-app/mods/herdr-ide                      # after any change
herdr-app status                                                         # load errors from the running window
bun test                                                                 # fast tier: the cache pruning in cache.js
```

## Conventions

One mod in three roles (`files`, `editor`, `menu`), because Herdr refuses imports across mod folders. `files.js` is a clone of Herdr's shipped `files`; keep edits to it small so it can be re-cloned. Plain gpui-kit JavaScript, 4-space indent except `files.js`, which keeps Herdr's 2.

## Tracker

Tracker: github
Board: none
Forge: github (gh)
