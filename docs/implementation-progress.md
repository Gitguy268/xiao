# Library and Arc workflows: progress

The plan is the brief "Xiao + OpenFinder: implementation plan for Claude Code" (revision 2, 21 October 2026). The approved working plan is `~/.claude/plans/implement-downloads-xiao-openfinder-clau-concurrent-blanket.md`. This page records what is done, how it was checked, and what comes next. Nothing on it is claimed before its test passes.

## Ground rules kept

- **Nothing is committed** in either repository (the user's choice). Xiao's 0.3.0 work, uncommitted before this began, is kept apart in `.git/xiao-baseline/`:
  - `0.3-tracked.patch` holds the diff of tracked files on 2026-10-21 before any Library change;
  - `0.3-untracked.tgz` holds the untracked files.
  
  The Library work can be reviewed as the difference from that baseline.
- Every e2e run happens in a throwaway HOME. The user's real Xiao 0.1 (`~/Applications/Xiao.app`) and real Downloads folder are never touched.
- The user's decisions (2026-10-21):
  - do all phases in order;
  - ship OpenFinder as an optional GPL pack;
  - commit nothing;
  - make "Files" a section inside Zen's own Library panel.

## Phase status

| Phase | State | Exit check |
|---|---|---|
| 0 Inventory and baseline | done | Baseline tests recorded below; startup and memory baselines in performance-results.md; the parity ledger is written |
| 1 Xiao look, adapter, bridge | done | A granted folder browses in real Xiao in both themes; every boundary check passes |
| 2 Library and downloads | done | Real downloads and folders are searchable; 10,000 items p95 8 ms; private and Tor downloads never appear; collections survive a restart; an unavailable folder has its own state |
| 3 Tidy names, safe changes | done; future-download routing deferred | Rename and undo survive a restart; collisions, case-only renames, compound extensions, stale and locked files, crash recovery and undo after a conflict all pass; Firefox's download list and history follow renames |
| 4 Arc-style browsing | done (2026-10-26) | Full Tor run 113 / 113. Built and passing: auto-archive across spaces with restore, `!` site shortcuts, Save to Clippings, Copy Clean Link, per-tab blocking pause, the shortcut list in Zen's settings, Zen rows driven in e2e (compact mode, spaces, Essentials, folders, split view and saved splits, Glance, routing with containers and Tor, Boosts, RSS live folders), journeys everyday, research, keyboard only, large library, broken website. Media controls need a check by hand (no audible signal in a test profile) |
| 5 Assist | done (2026-10-26) | `AI=1` run: first answer 79.4 s, warm 20.4 s, model process 3,472 MB, stop mid-answer then answer again (performance-results.md). Passages show before the model's answer. Two host faults fixed on the way. With AI off: no model, no hidden tab, no request |
| 6 Advanced and packs | done (2026-10-26; Tor run 122 / 122) | Export and import; Boards (note-based, the user's choice); the quick window on Zen's unsynced windows (spiked, then built); RSS live folders and saved splits verified; Boosts inherited. Sync and sharing: Zen's own, only with an account or when used, recorded in the ledger |
| 7 Release hardening | in progress | Done: upgrade and rollback of the database (a failed migration changes nothing and leaves a backup; an older Xiao refuses a newer database), accessible names in OpenFinder, CHANGELOG 0.4.0, both READMEs with screenshots, NOTICE. Open: an upgrade from the real 0.1 install, low disk and read-only app folder, final startup and memory figures, Linux Docker e2e; Windows untested |

## Test results (latest)

| Suite | Result |
|---|---|
| Xiao `npm test` | 66 / 66 (was 33 before this work) |
| Xiao `E2E_TOR=0 npm run e2e` | 113 / 113 on 2026-10-26, the last run, with every check |
| Xiao `npm run e2e:upgrade` | 7 / 7 on 2026-10-26: 0.1 → this build |
| Xiao `npm run e2e` (with Tor) | 122 / 122 on 2026-10-26, with every check added in this work (was 32 / 32 before it) |
| OpenFinder `npm test` | 5 / 5 |
| OpenFinder `npm run e2e` (Chromium) | 14 / 14 (2026-10-26) |
| OpenFinder `npm run licenses` | passes (it must be rerun after `licenses:write` for the Bricolage change) |

Bugs the tests caught on the way:
- The protocol named the Collections view `collection`, while OpenFinder sent `collections`. Both sides now test the shared list.
- Firefox's `Sqlite.sys.mjs` refuses any SQL in which `LIKE` is followed by a word, including a parameter called `:like`. A unit test now runs that check over every statement.
- Finished downloads live in Places history after a restart, not in the session list. Renames now update both.

## What changed

**Xiao**
- New:
  - `core/Library.mjs`, `LibraryStore.mjs`, `LibraryIndex.mjs`, `Downloads.mjs`, `FileOperations.mjs`, `ZenLibrarySection.mjs`, `LibraryUrlbar.mjs`;
  - `core/lib/library-protocol.mjs`, `library.mjs`, `naming.mjs`, `journal.mjs`;
  - `core/locales/en-US/xiao-library.ftl` and `core/icons/library-files.svg`;
  - `test/library.test.mjs` and `test/e2e/startup.mjs`;
  - `packs/library/manifest.json` (generated) and the `docs/` pages.
- Changed:
  - the actors (the Library bridge and its checks);
  - `XiaoCore.sys.mjs` (the Library's lifecycle, `openLibrary`, the switches);
  - `Toolbar.mjs` (the Library entry, the Files section attach);
  - `Packs.mjs` (a pack-installed notice);
  - the start page (the Library and "Remember my downloads" switches; the clock now wakes once a minute and sleeps in background tabs);
  - `chrome.css`, `scripts/packs.mjs` (the `library` pack with its checks), `scripts/build.mjs` (`locales/`);
  - `test/e2e/run.mjs` (sections 9–11).

**OpenFinder**
- Removed: the Liquid Glass system and the fake window.
- Added:
  - Xiao's tokens and fonts (`npm run tokens`), and the contract copied from Xiao (`npm run contract`);
  - a provider layer: `src/fs/types.ts`, `handles.ts` (standalone) and `xiao.ts` (inside Xiao);
  - capability checks instead of the Chromium gate;
  - a new UI in `src/library/`: sidebar, search, a virtual list and grid, preview, item menu, collections, tags, saved searches, Tidy Names review, activity and undo;
  - the `build:xiao` mode with its own CSP and `openfinder-build.json`.

## Known limits and open items

- **Route future downloads to folders** (brief §8, "tidy folders"): deferred. It needs a destination-grant interface; renaming and collections work without moving files.
- **Tidy names automatically for new downloads**: not built. Every rename is reviewed.
- **Trash:**
  - It uses `/usr/bin/trash` on macOS and `gio trash` on Linux.
  - The e2e does not empty anything into the user's real Trash, so trashing itself is checked only by its availability. Windows has no trash in the Library.
- **Full disk:** not simulated. A failed move reports `IO_ERROR`, and nothing is half-renamed, because a rename is a single move in one folder.
- **Multi-selection** in OpenFinder is not built yet. Bulk work goes through Tidy Names Here (up to 200 files).
- **README and screenshots** of both repos are not updated yet (Phase 7).
- **Linux and Windows** paths are untested.

## Next step

State on 2026-10-26, end of the fourth session:
- **Phases 0–6 are done.** Full Tor e2e 122 / 122; the `AI=1` run passes the model checks; the 0.1 → 0.4 upgrade passes 7 / 7.
- **Brief §19:** all 13 journeys have a check. Identity preservation is covered by separate checks (archive restore into its container, routed and restored Tor tabs, import keeping container names), not by one journey.
- **Phase 7 so far:** database upgrade and rollback; the 0.1 upgrade; accessible names; an interrupted download never reaches the Library and leaves no file; a read-only app folder makes a download say why and install nothing (both passing); CHANGELOG, READMEs with screenshots, NOTICE.
- **Bugs fixed in this session**, besides the earlier ones:
  - Assist's model host had two faults that killed answers ("The local AI stopped."): an idle countdown that kept running while it answered, and a host on its way out taking new questions.
  - The Assist page showed nothing until the model finished; the passages now show at once.
  - Closing an Assist page stopped any answer; now it stops only its own.
  - The import preview did not name the switches it would change; it does now, and it never switches on Assist without its model.

Open:
1. Startup figures on a quiet machine (the commands are in performance-results.md; this session's machine was at load 8–58).
2. The Linux Docker e2e (31 / 31 in 0.2) has not been repeated; Windows is untested.
3. Nothing is committed (the user's choice). OpenFinder's source must be public before the `library` pack is released, as for convert's.
