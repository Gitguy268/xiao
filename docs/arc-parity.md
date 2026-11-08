# Arc workflows in Xiao

Which of Arc's desktop workflows Xiao covers, and how. Arc is the behaviour reference, not the look: Xiao keeps its own design and its privacy rules (nothing leaves the computer unless you ask, AI is off until you turn it on).

Checked against **Zen 1.23.3b (Firefox 158) on macOS 27, Apple M4**, with the source of the installed Zen; the 0.6 rows and the feature-ID table below against **Zen 1.24.1b (Firefox 159.0.1)**. Zen provides much of what Arc does; for those rows Xiao's job is to check it works and fill gaps, not to build a second version.

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
| Instant links, several results | adapted (0.6) | `!top <search>` opens the top results of Xiao Search, the SearXNG on this computer (`--search`), read as JSON, in a new Zen folder (`core/InstantLinks.mjs`). Public SearXNG instances refuse scripted requests, so without Xiao Search the bang says what it needs instead of scraping | `test/instant.test.mjs`; `test/e2e/new-features.mjs` more |
| Assistant from the command bar | implemented | "Ask about this page" in Zen's command list (Xiao actions) | e2e checks the action list |
| Smart and live folders | implemented (saved searches); RSS live folders verified inherited; GitHub live folders inherited, unverified | Library saved searches; Zen live folders (`ZenLiveFoldersManager`, RSS and GitHub). Zen leaves out feed items that have no date | e2e "a saved search is a live collection", "Zen: an RSS live folder fills with the feed's items" (a feed from the fixture server, no network) |
| Calendar and GitHub previews | inherited for GitHub (Zen live folder), unverified; calendar adapted (0.6) | Zen `GithubLiveFolder`; calendar preview from an .ics address or file, next meeting with a countdown and Join link in Xiao's panel and the start page (`core/Calendar.mjs`) | `test/ics.test.mjs`; `test/e2e/new-features.mjs` more |
| Shared spaces, folders, splits | inherited, unverified | Zen Share, through share.zen-browser.app, only when you share | Phase 4 |
| Sync | inherited, unverified | Zen Spaces sync over Firefox Sync, only with a Firefox account | Phase 6 note |
| Import and export | implemented | `core/lib/portable.mjs` (the format, pure, node-tested) and `core/Portable.mjs`: Export… and Import… in the start page settings. One JSON file with spaces (tabs, folders, splits, container names), collections (saved searches; file collections by name only, relinked by name on import) and settings. Never in it: Tor or private tabs, folder paths, passwords in addresses, cookies, note or file contents. An import shows every address first, adds spaces without replacing any, and never downloads a pack. Firefox imports bookmarks and history | `test/portable.test.mjs`; e2e "an export holds the space…" and "an import shows what it holds…" (both passing) |
| Developer tools | inherited | Firefox devtools | |
| Custom shortcuts and site controls | adapted (shortcuts); implemented (site controls) | Zen's keyboard shortcuts (`about:keyboard` from Zen 1.24; `paneZenCKS` in Settings before) are the one list: every browser shortcut, rebindable, found with Settings' search. The start page's settings link to it ("Keyboard shortcuts…"). The Library's own keys (/ to search, arrows, Space, Enter, F2) are in its About panel. Xiao: per-site blocking switch and per-tab pause (panel and command list) | e2e "the start page's settings open the keyboard shortcuts list", "pausing blocking in a tab lets its ads load…" |

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

## Feature IDs from the Arc/Dia rebuild pack

Every feature in the Arc/Dia rebuild pack (researched 7 November 2026), by its ID, with what Xiao does about it. The same list is in [feature-ledger.json](feature-ledger.json). "Inherited" means Zen or Firefox does it; no row claims parity with Arc or Dia. The ten Arc mobile features (M01–M10) are out of scope: Xiao is a desktop browser.

| ID | Feature | Xiao | Where | Check |
|---|---|---|---|---|
| A01 | Vertical sidebar and focus behavior | inherited (verified) | Zen vertical tabs, compact mode | test/e2e/run.mjs "Zen: compact mode, spaces, Essentials…" |
| A02 | Spaces and switching contexts | inherited (verified) | Zen spaces | test/e2e/run.mjs same check |
| A03 | Profiles and separate browsing data | inherited (unverified) | Firefox profiles; containers verified; Xiao's Tor container | test/e2e/run.mjs "a link rule opens matching links in their space and its container" |
| A04 | Favorites as persistent icon tabs | inherited (verified) | Zen Essentials | test/e2e/run.mjs "Zen: compact mode, spaces, Essentials…" |
| A05 | Pinned tabs and pinned URL recovery | inherited (verified) | Zen pinned tabs, reset to pinned page | test/e2e/run.mjs same check |
| A06 | Nested folders and folder previews | inherited (verified) | Zen folders (one level exercised) | test/e2e/run.mjs "Zen: folders, split view and Glance" |
| A07 | Today tabs and auto-archive | implemented | core/Archive.mjs auto-archive (opt-in) | test/e2e/run.mjs "auto-archive closes an old tab…" |
| A08 | Archive browser and restore | implemented | Library Archive view, restore into space and container | test/e2e/run.mjs "an archived tab… opens again in its own container" |
| A09 | Command Bar: navigation, search, and commands | implemented | Zen address bar + Xiao actions (core/LibraryUrlbar.mjs) | test/e2e/run.mjs "the address bar shows Library files, and Xiao's actions join Zen's" |
| A10 | Site Search and search-engine selection | implemented | bangs (core/Bangs.mjs) | test/bangs.test.mjs; test/e2e/new-features.mjs bangs |
| A11 | Recent-tab switcher and tab shortcuts | adapted | Firefox Ctrl+Tab by recent use (look.yaml) | test/e2e/run.mjs "Ctrl+Tab goes to the tab used last" |
| A12 | Split View and saved split layouts | inherited (verified) | Zen split view, restored by the session store | test/e2e/run.mjs "Zen: a split view comes back after a restart…" |
| A13 | Peek link preview and promotion | inherited (verified) | Zen Glance | test/e2e/run.mjs "Zen: folders, split view and Glance" |
| A14 | Little Arc and external-link windows | adapted | Quick window (core/QuickWindow.mjs) | test/e2e/run.mjs "quick window: a link from another app…" |
| A15 | Air Traffic Control link routing | inherited (verified) | Zen space routing (now in Zen's Library) | test/e2e/run.mjs "a link rule opens matching links…" |
| A16 | Themes, icons, and sidebar personalization | inherited (unverified) | Zen themes, grain (1.24.1b), accent from look.yaml | none automated |
| A17 | Multi-window tab handoff | inherited (unverified) | Zen windows and tab moving |  |
| A18 | Video Picture-in-Picture | inherited (unverified) | Firefox picture-in-picture | needs a check by hand |
| A19 | Meeting PiP and share-this-tab controls | inherited (unverified) | Firefox/Zen WebRTC sharing indicators |  |
| A20 | Audio mini player | inherited (unverified) | Zen media controller card | needs a check by hand (test profiles never mark audio audible) |
| A21 | Live calendar preview and join countdown | adapted | Calendar preview from an .ics address or file (core/Calendar.mjs, core/lib/ics.mjs); panel and start page, not a sidebar card | test/ics.test.mjs; test/e2e/new-features.mjs more "the calendar preview shows the next meeting…" |
| A22 | GitHub Live Folders | inherited (unverified) | Zen GitHub live folders |  |
| A23 | Boosts: visual website customization | inherited (verified) | Zen Boosts (focus and sharing from 1.24) | test/e2e/run.mjs "a Boost hides an element…" |
| A24 | Boosts: custom CSS, JavaScript, and gallery | inherited (verified) | Zen Boosts custom CSS | test/e2e/run.mjs same check |
| A25 | Easels: spatial canvas | adapted | Boards: notes in topics, not a free canvas (core/Boards.mjs) | test/e2e/run.mjs "Boards: links and quotes go into topics…" |
| A26 | Web captures and live capture cards | deferred | Firefox Screenshots for static captures; no live capture cards |  |
| A27 | Easel collaboration, sharing, and export | adapted | Board export as Markdown or a page that runs nothing | test/e2e/run.mjs Boards check |
| A28 | Arc Notes | unsupported | retired by Arc; Xiao's sticky notes cover notes |  |
| A29 | Library: downloads, media, and saved creations | implemented | Library pack (OpenFinder) and Zen's Library panel | test/e2e/run.mjs sections 9–10 |
| A30 | Super Copy, Markdown links, and Share Quote | implemented | Copy as Markdown: link, page, quote with a link to its words (core/lib/markdown-link.mjs); Save to Clippings | test/markdown-link.test.mjs; test/e2e/new-features.mjs more "Copy as Markdown…" |
| A31 | Developer Mode and development conveniences | inherited (unverified) | Firefox devtools |  |
| A32 | Arc Max: Tidy Tab Titles | implemented | Tidy tab titles, rules (core/Assist.mjs) | test/e2e/run.mjs "tidy titles shortens titles…" |
| A33 | Arc Max: Tidy Downloads | implemented | Tidy file names (core/lib/naming.mjs), optional local AI | test/e2e/run.mjs section 11 |
| A34 | Arc Max: 5-Second Previews | inherited (unverified) | Firefox Link Preview (Shift+Alt hover; key points need Mozilla's model download) and Zen Glance; Xiao's Summarize Link on the local model | none automated |
| A35 | Arc Max: Ask on Page | implemented | Ask about this page (core/Assist.mjs), local model | test/e2e/run.mjs section 13; AI=1 |
| A36 | Arc Max: Tidy Tabs | implemented | Group tabs by site into Zen folders; also by command on the All tabs page | test/e2e/run.mjs "tabs from one site can be grouped…" |
| A37 | Arc Max: Instant Links and Ask ChatGPT | adapted | !top: top results of Xiao Search (local SearXNG, JSON) in a Zen folder (core/InstantLinks.mjs); needs --search | test/instant.test.mjs; test/e2e/new-features.mjs more "!top opens the top results…" |
| A38 | Space/folder sharing and link bundles | inherited (unverified) | Zen Share (share.zen-browser.app, only when you share) |  |
| A39 | TypeTravel coverage gap | deferred | no evidence of the behaviour (pack: discovery item) |  |
| A40 | Historical extras: Reader Mode, previews, membership UI | inherited (unverified) | Firefox reader view |  |
| D01 | Intelligent Command Bar and new-tab page | implemented | start page + Zen address bar with Xiao's actions and bangs | test/e2e/run.mjs start page checks |
| D02 | Contextual chat beside a page | implemented | Assist beside the page (Zen split view) | test/e2e/run.mjs section 13 |
| D03 | Tab mentions and context attachment picker | implemented | Assist "Also read…": other tabs as sources, passages keep their page (core/lib/assist-more.mjs) | test/assist-more.test.mjs; test/e2e/new-features.mjs more "Assist reads a mentioned tab too…" |
| D04 | Mention an entire Tab Group | implemented | Assist "Also read…" a Zen folder's tabs | test/assist-more.test.mjs |
| D05 | Page understanding and structured extraction | implemented | page passages via XiaoChild extract (text only) | test/e2e/run.mjs section 13 |
| D06 | Ask on Page and selected-content questions | implemented | Ask about this page; selection used when there is one | test/e2e/run.mjs section 13 |
| D07 | Page, video, PDF, image, and spreadsheet summaries | adapted | pages and links summarised on the local model; PDFs through Firefox's viewer text; no video, image or spreadsheet summaries | test/e2e/run.mjs AI=1 |
| D08 | Writing assistance, rewrite proposals, and insertion | implemented | writing tools in the sticky note, local model | test/e2e/new-features.mjs public |
| D09 | AI form filling | unsupported | AI form filling: Xiao's AI never acts on pages |  |
| D10 | Email drafts and calendar-event preparation | unsupported | needs mail and calendar accounts; local-first |  |
| D11 | Research, deeper reasoning, and model routing | unsupported | one local model; no cloud models to route to |  |
| D12 | Citations, source inspection, and tool activity | implemented | cited answers; citations to passages not given are dropped | test/assist.test.mjs |
| D13 | Rich answers, code, tables, charts, and artifacts | unsupported | answers are plain text by design: nothing in an answer can act |  |
| D14 | Reports from multiple tools and tabs | deferred | multi-tab answers exist (D03); written reports not yet |  |
| D15 | Deck generation | unsupported | deck generation: out of scope |  |
| D16 | Reusable Skills and invocation | implemented | Skills: notes named "Skill <name>.md", run with /name | test/e2e/new-features.mjs more "a skill is saved as a note…" |
| D17 | Natural-language Skill builder | adapted | New skill form: a name and a sentence become the note; no model rewriting | test/assist-more.test.mjs |
| D18 | Skill discovery, sharing, and gallery | adapted | skills are notes, so they sync and share like notes; no gallery |  |
| D19 | Personalization and custom response instructions | implemented | Assist "Your style": style only, never facts | test/assist-more.test.mjs |
| D20 | Historical Memory and ChatGPT-history import | unsupported | retired by Dia; Xiao keeps no memory of chats unless you keep them as a note |  |
| D21 | Search browsing history, chats, and generated files | implemented | answers can be kept in the note "Assist chats", found by the Library's search | test/assist-more.test.mjs |
| D22 | Voice dictation | deferred | Whisper runs in the voice organiser; dictation in Assist not wired yet |  |
| D23 | Queued messages, steering, stop, and resume | implemented | questions asked while Assist answers wait in a queue; Cancel drops them too | none automated |
| D24 | Connected-app framework and tool execution | unsupported | connected apps: local-first |  |
| D25 | Connected-app capability inventory | unsupported | connected apps: local-first |  |
| D26 | Accounts, workspace selection, and connection discovery | unsupported | accounts: local-first |  |
| D27 | Proactive suggestions | unsupported | proactive suggestions: Xiao doesn't act unasked |  |
| D28 | Morning Brief | unsupported | needs accounts and background reading |  |
| D29 | Live Calendar and meeting reminders | adapted | calendar preview (A21) from an .ics address or file | see A21 |
| D30 | Meeting Tab Groups | unsupported | needs calendar accounts |  |
| D31 | Tab Groups, pinned groups, and restore | inherited (verified) | Zen folders and pinned folders | test/e2e/run.mjs folder checks |
| D32 | Automatic grouping, names, icons, and link grouping | adapted | group by site, rules (A36); no AI names | test/e2e/run.mjs grouping check |
| D33 | Manage tabs and groups through chat | adapted | All tabs page: commands in words become a plan you confirm; rules, not a model (core/lib/tabplan.mjs, core/TabCommands.mjs) | test/tabplan.test.mjs; test/e2e/new-features.mjs more "close tabs about yt…", "move … to Work…" |
| D34 | Profiles, linked data, swiping, and defaults | inherited (unverified) | Firefox profiles; Zen 1.24 imports Arc and Dia profiles | test/e2e/new-features.mjs more "Zen's Arc and Dia importers…" |
| D35 | Incoming-link rules | inherited (unverified) | Zen space routing; Xiao's quick window | see A15, A14 |
| D36 | Top tabs, sidebar, Focus Mode, and themes | inherited (verified) | Zen compact mode (hides sidebar and top bar) | test/e2e/run.mjs compact mode check |
| D37 | Favorites, named pins, home URLs, and custom labels | inherited (unverified) | Zen Essentials, pinned tabs with reset, renamed tabs | see A04, A05 |
| D38 | Split View with independent pane controls | inherited (unverified) | Zen split view | see A12 |
| D39 | Tab search, overflow, recent switcher, and bulk actions | implemented | All tabs page: every space, search, tick, close, archive, group, mute, move | test/e2e/new-features.mjs more |
| D40 | GitHub Live Groups and PR stacks | inherited (unverified) | Zen GitHub live folders |  |
| D41 | Live Documents and work-activity groups | unsupported | needs work accounts |  |
| D42 | Tidy Tabs, cleanup groups, and empty-new-tab cleanup | implemented | Close new tabs left empty after 5, 15 or 60 minutes | test/e2e/new-features.mjs more "new tabs left empty close…" |
| D43 | Media: PiP, stashing, Spotify controls, and site mute | implemented | Always mute this site (core/SiteMute.mjs); Firefox PiP; Zen media card | test/e2e/new-features.mjs more "Always mute this site…" |
| D44 | Meeting screen-share handoff and presentation indicators | inherited (unverified) | Firefox/Zen sharing indicators |  |
| D45 | Cross-device sync | inherited (unverified) | Zen spaces sync over Firefox Sync, with a Firefox account |  |
| D46 | Arc/Chrome migration and portable export | implemented | Xiao export/import (core/lib/portable.mjs) and Zen's Arc/Dia/Chrome importer from the start page | test/portable.test.mjs; test/e2e/run.mjs import checks |
| D47 | Extensions, side panels, and extension synchronization | inherited (unverified) | Firefox extensions (sidebar panels), Firefox Sync |  |
| D48 | Privacy settings and AI permission boundaries | implemented | AI off until switched on, on this computer only; never Tor tabs or private windows; silent mode | test/e2e/network-audit.mjs |
| D49 | Enterprise identity, SSO, and managed policies | inherited (unverified) | Firefox enterprise policies |  |
| D50 | Plans, usage limits, trial, credits, and billing UI | unsupported | Xiao is free; no plans or billing |  |
| C01 | Browser engine and process boundaries | inherited (unverified) | Gecko (Zen 1.24.1b, Firefox 159.0.1), Fission |  |
| C02 | Tab state machine and command service | adapted | tab commands share functions with the UI (core/TabCommands.mjs) | test/e2e/new-features.mjs more |
| C03 | Storage partitions, credentials, and private browsing | inherited (verified) | Firefox containers, private windows; Xiao's Tor container | test/e2e/run.mjs Tor checks |
| C04 | Security, site permissions, blockers, and AI authorization | implemented | Xiao blocker, per-site switch, fingerprint noise, actors that trust nothing a page sends | test/e2e/run.mjs blocking checks; test/e2e/new-features.mjs shield |
| C05 | Navigation and ordinary page controls | inherited (unverified) | Firefox |  |
| C06 | History, bookmarks, Find, and local search | inherited (unverified) | Firefox history, bookmarks, Find; Xiao's Library search |  |
| C07 | Artifacts, files, exports, and clipboard | implemented | PDF tools page, Board export, Copy as Markdown | test/e2e/new-features.mjs pdf, more |
| C08 | Downloads and upload integration | implemented | Firefox downloads + Library hook | test/e2e/run.mjs download journeys |
| C09 | Keyboard, pointer, accessibility, and localization | implemented | accessible names on Xiao's pages; Zen shortcuts in about:keyboard | test/e2e/run.mjs "the start page's settings open the keyboard shortcuts list" |
| C10 | Operating-system integration and windows | inherited (unverified) | Firefox/Zen |  |
| C11 | Media, calls, capture, casting, and device permissions | inherited (verified) | Firefox permissions; Xiao's blank camera | test/e2e/new-features.mjs extras |
| C12 | Provider integrations and background refresh | adapted | only Xiao Search (local) and calendar addresses you set |  |
| C13 | Persistence, synchronization, backup, and deletion | implemented | xiao.json, notes as files, Library database with upgrade/rollback | test/e2e/run.mjs database checks |
| C14 | Developer tools and extension compatibility | inherited (unverified) | Firefox devtools and WebExtensions |  |
| C15 | AI runtime, grounding, tool gateway, and evaluation | implemented | local model host, grounded and cited, model output never acts | test/assist.test.mjs; AI=1 |
| C16 | Settings, account lifecycle, updates, and diagnostics | implemented | start page settings, signed updates with rollback | test/e2e/new-features.mjs updates |
