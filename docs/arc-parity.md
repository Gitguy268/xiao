# Arc workflows in Xiao

Which of Arc's desktop workflows Xiao covers, and how. Arc is the behaviour reference, not the look: Xiao keeps its own design and its privacy rules (nothing leaves the computer unless you ask, AI is off until you turn it on).

Checked against **Zen 1.23.3b (Firefox 158) on macOS 27, Apple M4**, with the source of the installed Zen. Zen provides much of what Arc does; for those rows Xiao's job is to check it works and fill gaps, not to build a second version.

States:
- **inherited**: Zen does it. *Unverified* until an e2e check in `test/e2e/run.mjs` proves it in Xiao.
- **implemented**: Xiao's own code, with a test.
- **adapted**: an Arc idea done differently on purpose; the reason is given.
- **deferred**: not built yet, with the reason.
- **unsupported**: will not be built; reason given.

A menu entry or a placeholder never counts as implemented.

## Ledger

| Workflow | State | Where | Check |
|---|---|---|---|
| Vertical sidebar, compact mode | verified inherited | Zen `ZenVerticalTabsManager`, `gZenCompactModeManager` | e2e "Zen: compact mode, spaces, Essentials and resetting a pinned tab" (toggles compact mode) |
| Spaces and their themes | verified inherited | Zen `gZenWorkspaces.createAndSaveWorkspace`, `changeWorkspaceWithID` | same check (creates a space and switches to it) |
| Profiles and containers | containers verified inherited; profiles inherited, unverified; Xiao adds the Tor container | A space's container (`containerTabId`) is given to tabs routed into it; Firefox profiles; `core/Tor.mjs` | e2e "a link rule opens matching links in their space and its container"; Tor: e2e "Tor tab goes through Tor" |
| Favorites (Essentials) and pinned tabs, reset to the pinned page | verified inherited | Zen `gZenPinnedTabManager.addToEssentials`, `resetPinnedTab` | same check (a pinned tab that navigated away goes back to its pinned page) |
| Nested folders | verified inherited (one level exercised) | Zen `gZenFolders.createFolder` (`zen.folders.max-subfolders` 5) | e2e "Zen: folders, split view and Glance" |
| Temporary tabs and auto-archive | implemented | `core/Archive.mjs` (opt-in: 12 h to a week); every space, not only the one on screen (Zen's `gBrowser.tabs` holds only that one, so Xiao uses `allStoredTabs`); Library Archive view, restore into its space and container; kept 30 days | e2e "auto-archive closes an old tab…", "…keeps pinned tabs, unsaved work and Tor tabs…", "an archived tab… opens again in its own container" |
| Command bar | implemented (adapter) | Zen's address bar and action list; Xiao adds its actions and Library results (`core/LibraryUrlbar.mjs`) | e2e "the address bar shows Library files, and Xiao's actions join Zen's" |
| Recent tab switcher | adapted (pref) | Firefox Ctrl+Tab with `browser.ctrlTab.sortByRecentlyUsed` on in `shared/prefs/look.yaml` (Zen ships it off) | e2e "Ctrl+Tab goes to the tab used last" |
| Split view, saved splits | verified inherited | Zen `gZenViewSplitter.splitTabs`, `unsplitCurrentView`; a split comes back after a restart when "the tabs from last time" is chosen (Zen's session store) | e2e "Zen: folders, split view and Glance", "Zen: a split view comes back after a restart…" |
| Peek | verified inherited | Zen Glance (`gZenGlanceManager.openGlance`, `closeGlance`) | same check |
| Little Arc quick window | adapted; passing (2026-10-26) | Features → Quick window (`core/QuickWindow.mjs`): Firefox opens links from other apps in a new window (`browser.link.open_newwindow.override.external` = 2) and Xiao marks it as one of Zen's unsynced windows, 960 × 720, apart from your spaces. Zen's own "Move tabs to" button on its space name keeps the tab in a space (`ZenWindowSync.moveTabsToSyncedWorkspace`). Zen's Glance setting `zen.glance.open-essential-external-links` is about links from pinned and Essential tabs, not other apps. A link that matches one of the reader's routing rules still goes to that rule's space (e2e "quick window: a link that matches a routing rule…", passing); Zen's default space for links from other apps is what the quick window replaces, and the Features text says so. If a Zen update changes the hook, the switch does nothing and logs once | e2e "quick window: a link from another app opens in its own unsynced window…" (the link goes through Firefox's command-line handler) |
| Link routing | verified inherited | Zen space routing (`ZenSpaceRoutingManager`: rules `contains`, `equal-to` or `regex`, first match wins, a default for links from other apps; stored in `zen-space-routing.jsonlz4`). A Tor tab moved by a rule keeps its Tor container. `contains` is a plain substring test, so `example.org` also matches `notexample.org`: use `regex` (e.g. `^https://([^/]+\.)?example\.org/`) for a strict rule. Xiao leaves Zen's matcher as it is | e2e "a link rule opens matching links in their space and its container", "a routed Tor tab moves space but stays in Tor" |
| Site search shortcuts | implemented | `core/Bangs.mjs`, `core/lib/bangs.mjs`, `core/bangs.json`: local bangs in the address bar and start page, replacing 0.4's five search engines | `test/bangs.test.mjs`; `test/e2e/new-features.mjs` bangs section; e2e "bangs: !w kittens…" |
| Library: downloads, files, notes, collections | implemented | `core/Library*.mjs`, `core/Downloads.mjs`; OpenFinder as the `library` pack; a Files section in Zen's own Library panel | e2e section 9 and 10 |
| Library: saved tabs, archive | archive implemented; "Saved Tabs" adapted | The Archive view holds closed tabs; saving open tabs for later is done with Zen's folders and spaces, so there is no separate Saved Tabs list | archive checks above |
| File preview | implemented | `preview.open`: pictures, sound, video as themselves; text, pages and SVGs as plain text; PDFs open in Firefox's viewer | e2e "a text file is previewed through the bridge"; OpenFinder e2e "a page or SVG is previewed as text, never run" |
| Capture and quote sharing | implemented (quotes); screenshots inherited | "Save to Clippings" in the context menu (`core/Toolbar.mjs`, `Notes.clip`): quote + source link without query; Firefox Screenshots | e2e "Save to Clippings keeps the quote and its source" |
| Easel-like boards | adapted (the user's choice, 2026-10-26); passing | Features → Boards (`core/Boards.mjs`, `core/board/`). A board is a sticky note named "Board <title>.md" in the voice organiser's shape (topics, tasks, questions), so it syncs with textarea like any note; the page shows it as cards with clickable links, tickable tasks and inline adding. "Add to Board" in a page's menu adds the link, the selected words with their page, or the page. Export as Markdown or as a web page that runs nothing. Adapted from Easel's free canvas: notes in topics fit how Xiao's notes already work. Screenshots stay with Firefox Screenshots. Built in rather than a download: it is a few KB | e2e "Boards: links and quotes go into topics…"; `test/board.test.mjs` |
| Boost-like site changes | verified inherited | Zen Boosts (`gZenBoostsManager`; `zen.boosts.enabled`, on by default): colours, fonts, CSS and "zap" to hide elements, per site, switched off per site. Switching a Boost off takes effect on the page's next load, not at once (checked on 2026-10-25: the element was still hidden 5 s later and back after a reload); this is Zen's behaviour and Xiao leaves it | e2e "a Boost hides an element; switched off, the element is back after the next load" |
| Mini player, picture-in-picture | inherited, unverified | Zen `gZenMediaController` (the card in the sidebar), Firefox picture-in-picture (`media.videocontrols.picture-in-picture.enabled` on). Tried on 2026-10-25: a test page's audio plays, but in a test profile Firefox never marks it audible (headless or headed), so its media controller stays inactive and Zen shows no card. Needs a check by hand on a real machine | none automated |
| Tidy tab titles | implemented (rules) | `core/Assist.mjs` `tidyTitles`, command "Tidy tab titles" and undo; manual names win | e2e "tidy titles shortens titles…" |
| Tidy tabs (grouping) | implemented (rules) | `groupBySite` → confirm → Zen folders; "Undo tab groups" | e2e "tabs from one site can be grouped into a folder and put back" |
| Tidy downloads and file names | implemented | `core/lib/naming.mjs`, `core/FileOperations.mjs`, OpenFinder Tidy Names review; optional local-AI suggestions | e2e section 11 |
| Ask on page | implemented | `core/Assist.mjs` + `core/assist/` beside the page (split view); evidence passages without AI, cited answers with MiniCPM5 | e2e section 13; AI=1 "the local AI answers from the page with citations, then unloads" |
| Link summaries | implemented | "Summarize Link" in the link menu (Assist on); fetched without cookies only when chosen | page code shared with Ask; model run in AI=1 |
| Instant links, several results | deferred | Needs a search results source Xiao can read; public SearXNG instances refuse scripted requests (see `core/Search.mjs`), so opening "the top results" would mean scraping. Not built rather than built badly | |
| Assistant from the command bar | implemented | "Ask about this page" in Zen's command list (Xiao actions) | e2e checks the action list |
| Smart and live folders | implemented (saved searches); RSS live folders verified inherited; GitHub live folders inherited, unverified | Library saved searches; Zen live folders (`ZenLiveFoldersManager`, RSS and GitHub). Zen leaves out feed items that have no date | e2e "a saved search is a live collection", "Zen: an RSS live folder fills with the feed's items" (a feed from the fixture server, no network) |
| Calendar and GitHub previews | inherited for GitHub (Zen live folder), unverified; calendar deferred | Zen `GithubLiveFolder` | |
| Shared spaces, folders, splits | inherited, unverified | Zen Share, through share.zen-browser.app, only when you share | Phase 4 |
| Sync | inherited, unverified | Zen Spaces sync over Firefox Sync, only with a Firefox account | Phase 6 note |
| Import and export | implemented | `core/lib/portable.mjs` (the format, pure, node-tested) and `core/Portable.mjs`: Export… and Import… in the start page settings. One JSON file with spaces (tabs, folders, splits, container names), collections (saved searches; file collections by name only, relinked by name on import) and settings. Never in it: Tor or private tabs, folder paths, passwords in addresses, cookies, note or file contents. An import shows every address first, adds spaces without replacing any, and never downloads a pack. Firefox imports bookmarks and history | `test/portable.test.mjs`; e2e "an export holds the space…" and "an import shows what it holds…" (both passing) |
| Developer tools | inherited | Firefox devtools | |
| Custom shortcuts and site controls | adapted (shortcuts); implemented (site controls) | Zen's Keyboard Shortcuts settings (`paneZenCKS`) are the one list: every browser shortcut, rebindable, found with Settings' search. The start page's settings link to it ("Keyboard shortcuts…"). The Library's own keys (/ to search, arrows, Space, Enter, F2) are in its About panel. Xiao: per-site blocking switch and per-tab pause (panel and command list) | e2e "the start page's settings open the keyboard shortcuts list", "pausing blocking in a tab lets its ads load…" |

## Journeys (brief §19)

| Journey | State | Check |
|---|---|---|
| Everyday download | passing (2026-10-26) | e2e "journey \"everyday download\"…" (download, find by original name, accept the tidy name, open) and its restart half (undo refuses over a newer file, then succeeds). Show in Finder is left out of the automated run because it opens a real Finder window |
| Research session | passing (2026-10-26) | e2e "journey \"research session\"…": a space, a clipped quote in a note, the note in a collection, tabs auto-archived, found and reopened in their space |
| Keyboard only | passing (2026-10-26) | e2e "keyboard only: address bar → Library → ⇧⌘F (search the whole Library) → find a file → preview → rename → back to the page": real key presses, no clicks. Tracing it found two Library bugs, both fixed: a background scan cleared the selection, and the search stayed inside whatever folder the Library was left in, with no key to search everything |
| Large library | passing (2026-10-26) | e2e "journey \"large library\"…": during a scan of 10,000 files a search answers, the sidebar shows the scan with a stop button, the page stops it (`roots.stopScan`), and everything found so far stays searchable. "…a late answer to an older search never replaces the newer one": an older search made to answer 1.5 s late, then a newer one typed in the page; the list shows only the newer results |
| Identity preservation | partly | an archived tab reopens in its container; a routed Tor tab keeps Tor; restored Tor tabs never go direct. Not one journey yet |
| Private browsing | passing | private and Tor downloads never reach the Library; Assist refuses Tor tabs; the Library refuses private windows |
| Broken website | passing | e2e "pausing blocking in a tab lets its ads load, and closing the tab ends the pause" |
| Offline work | passing (2026-10-26) | e2e "journey \"offline work\"…": with Firefox offline the Library searches, previews a local file and shows a note edited meanwhile, and no request is made |
| AI disabled | passing (2026-10-26) | "with AI off, Assist still finds where the page answers…" (passing) and "with AI off, asking Assist makes no network request" (new) |
| AI interruption | passing with a stand-in model (2026-10-26); the real model's stop is in the `AI=1` run | e2e "journey \"AI interruption\"…": a new question stops the first answer, Cancel stops the next, and nothing answers late; e2e "closing Assist while it writes an answer stops that answer" (only the answer that page asked for, `XiaoParent.didDestroy`) |
| Filesystem conflict | passing (2026-10-26) | e2e "journey \"filesystem conflict\"…": a file replaced outside Xiao while its tidy name is under review is not renamed (STALE_ITEM) and the replacement is untouched; undo never replaces a newer file |
| Upgrade and rollback | passing (2026-10-26) | e2e "upgrade: a migration that fails changes nothing and leaves a backup; an older Xiao refuses a newer database…" (passing). `npm run e2e:upgrade` (`test/e2e/upgrade.mjs`, 7 / 7 on 2026-10-26): 0.1 built from its commit and installed in a throwaway home, then this build over it: Xiao.app replaces xiao.app, 0.1's extension is gone, a bookmark and history from 0.1 are kept, every feature starts off and Xiao opens on its start page |
| Standalone use | passing | OpenFinder's own Playwright suite in Chromium, with no Xiao |

Also checked: Firefox's own **Copy Clean Link** (`context-stripOnShareLink`, `privacy.query_stripping.strip_on_share.enabled`), e2e "Firefox's Copy Clean Link is there and drops trackers from links".

## Boundaries, on purpose

- No second rendering engine, password manager, extension store or updater: Firefox and Zen's own are used.
- Not part of the first release: mobile Arc and Arc Search, a public gallery, cloud collaboration, an account service.
- Zen's Share and live folders talk to the network only when you use them (share.zen-browser.app; the RSS or GitHub address you add, every 30 minutes). Xiao leaves them as Zen ships them and says so here.
