# The Library: how it is built

The Library is OpenFinder (a separate GPL-3.0-or-later project, same author) running inside Xiao as an optional pack. Xiao owns the files, the permissions and the index. OpenFinder owns the interface.

## Pieces

| Piece | Where | Job |
|---|---|---|
| Library page | OpenFinder, built with `npm run build:xiao`, shipped as the `library` pack, served at `resource://xiao-library/index.html` | The interface |
| Bridge | `core/actors/XiaoChild.sys.mjs` (`window.xiao.request`) and `XiaoParent.sys.mjs` (`isLibrary()`) | One function into Xiao, checked on every call |
| Contract | `core/lib/library-protocol.mjs` | Methods, payload checks, limits, error codes. Pure; tested by node |
| Authority | `core/Library.mjs` | Grants, path resolution, handlers |
| Store | `core/LibraryStore.mjs` | `<profile>/xiao-library.sqlite` |
| Index | `core/LibraryIndex.mjs`, `core/lib/library.mjs` | Scans and searches |
| Downloads | `core/Downloads.mjs` | Firefox's download list → single-file grants |
| Zen's panel | `core/ZenLibrarySection.mjs` | The "Files" section |
| Address bar | `core/LibraryUrlbar.mjs` | Library results and Xiao's actions |

## Decisions

| Decision | Choice | Why / evidence |
|---|---|---|
| One library | Zen's Library panel stays the entry point and gains a Files section; the full Library is one tab | The user chose this on 2026-10-21. Zen 1.23.3b already has History, Downloads, Boosts, Media, Spaces and Archive; rebuilding those would be a second library |
| Library surface | A pack page in a normal tab, opened or focused by `Xiao.openLibrary()` | `resource://` pages already work this way for packs. e2e: "opening the Library again focuses its tab" |
| UI delivery | Optional GPL pack, pinned by SHA-256 like the other packs | Keeps OpenFinder's GPL code out of Xiao's MPL files; same as the file converter |
| File authority | The parent process does every file operation | Content processes cannot read user folders by URL (Firefox sandbox), and should not |
| Origin check | `documentPrincipal.originNoSuffix === 'resource://xiao-library'`, exact path, top level, `isCurrentGlobal`, not private, not the Tor container | The actor runs in every frame (`allFrames`, no `matches`), so every check is in the parent. e2e covers frames, navigation, the start page, Tor and private windows |
| Paths | The page sends a root id plus plain names; `safeName` rejects separators, `..`, controls, bidi overrides, device names; links are never followed | e2e "the Library cannot leave its folder" |
| Storage | One SQLite database through `Sqlite.sys.mjs` (`openConnection`, `executeTransaction`, `backup`) | Supported Firefox API. Only Xiao writes it; standalone OpenFinder keeps its own IndexedDB |
| Search | Names, earlier names, tags and collections, in memory while the Library is used, ranked by `core/lib/library.mjs` | 10,000 items: p95 under 100 ms in node and in the browser (e2e measured 8 ms) |
| Downloads | Each finished download of the normal profile becomes a single-file grant; the Downloads folder itself is never granted | Private and Tor downloads must not be found by a later folder scan; see "Limits" |
| Contract ownership | Written in Xiao (MPL), copied into OpenFinder by `npm run contract`; the pack builder refuses a build made with another copy | MPL code may go into GPL, not the reverse |
| Design tokens | `shared/tokens.css` is copied into OpenFinder by `npm run tokens`; the build records its hash | One source; drift is reported by `npm run packs` |

## What runs when

| State | What runs |
|---|---|
| Library off (no pack) | Nothing. No database, no hook, no scans |
| On, page closed | The download hook (one view on Firefox's download list) while "Remember my downloads" is on. No scans |
| Page open | Folder scans at most every 10 minutes, in batches of 400 with pauses; queries; previews of the selected file |
| Search index | Built in memory on the first query, let go after 5 idle minutes |
| Switched off | The hook is removed, scans stop, the database is closed. Tags, collections and the journal stay in the profile; the pack's files are deleted (Xiao's rule for packs) |

## Schema (version 1)

`roots`, `items` (derived), `downloads`, `collections` (a non-null `query` makes a saved search), `memberships`, `tags`, `archive`, `operations` (the rename journal). Tags and memberships point at `(root, path)`, so they survive a rescan. Before any migration the database is copied to `xiao-library.sqlite.v<N>.bak`. A database from a newer Xiao is refused, not changed.

## Limits

- **A download saved into a folder you also gave the Library is a file in that folder.** A scan of that folder finds it however it arrived, including from a private window. Xiao never grants the Downloads folder by itself, and keeps no list of private file names (such a list would itself leak).
- Scans skip names starting with a dot and these folders: `node_modules`, `bower_components`, `.git`, `.svn`, `.hg`, `__pycache__`, `.venv`, `venv`, `target`, `build`, `dist`, `.next`, `.cache`. They go at most 12 folders deep and stop at 100,000 items per folder.
- File identity for renames is size, modification time and name. Firefox has no file id API.
- macOS is tested. Linux and Windows code paths exist but are not yet run.
