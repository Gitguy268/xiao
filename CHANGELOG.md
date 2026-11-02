# Changelog

## 0.5.2 (2 November 2026)

- Silent mode no longer cancels "Save Link As" and "Save Page As", which it had treated as the browser's own requests.

## 0.5.1 (2 November 2026)

- The first update delivered by Xiao itself, confirming that updating from 0.5.0 works from the public release.

## 0.5.0 (2 November 2026)

- **Silent mode** (Features, off by default): Xiao connects to nothing by itself, only the pages and downloads you ask for. Tor and Xiao Search stay stopped, and updates, filters and DRM wait for a button. The cost is said beside the switch: certificate and phishing lists go out of date. An idle test logs every connection the browser makes, and in silent mode it finds none.
- **Quieter in normal mode too:** the hourly filter timer is gone (once at launch, at most daily), and Tor is only checked while you use it.
- **Local-only data:** Firefox Accounts and Firefox Sync are off. Notes folder sync stays, because it is a folder you choose.
- **Your fingerprint varies** (on by default, with a switch per site in Xiao's button): audio, canvas and WebGL readings get tiny noise, and the core count varies, differently on each site and after each restart, the idea Brave calls farbling. Screen size and graphics card read as common values.
- **Blank camera** (off until chosen): sites you pick see a blank picture, and your camera never turns on.
- **Bangs** (on by default): `!gh cats` or `cats !gh` in the address bar or start page goes straight to that site's search, from a list of about 13,000 names kept on this computer. Add your own. They replace the five site shortcuts. `!note` opens your notes, `!lib` the Library, `!ol` Open Library.
- **Start page styles:** Normal, Liquid glass, Terminal and Retrofind, each light, dark or matching the system. Terminal has a keyboard prompt; type `help`.
- **Liquid glass setting** for Xiao's toolbars, panels and sticky note.
- **Notes are easier to reach:** a Notes button on the start page and in Xiao's button, "Open your notes" in the command bar, and `!note`.
- **From textarea** (off until chosen): Send to a device over your Wi-Fi with no server, writing tools in the sticky note, `#tags`, and dictating into a note.
- **Clipboard history** (off until chosen): the last 50 things copied from pages, never password fields, private windows or Tor tabs, plus a page showing every format a paste holds.
- **Reader** (off until chosen): EPUB and PDF from this computer in one or two page views. A book can't run scripts or reach the network.
- **Translate this page** in Xiao's button, using Firefox's local translation.
- **Downloads explain themselves:** a check before anything is written, problems in plain words, and Try again.
- **Automatic updates**, signed with Xiao's own key, installed at the next start, and undone by themselves if that start fails.
- **Linux:** with no Zen to copy, including Flatpak-only computers, the installer downloads Zen's own tarball, and a missing library names the package to install.

## 0.4.0

- **The Library** (Features → Library, an optional download built from OpenFinder, GPL-3.0-or-later): one searchable place for your downloads, the folders you give it, your notes, collections and closed tabs. It runs in its own tab with Xiao's look and reaches files only through Xiao, one folder at a time. Private windows and Tor tabs never reach it, and never add to it.
  - **Downloads** are remembered with the name they came with, so a file stays findable after a rename. "Remember my downloads" can be switched off.
  - **Search** by name, earlier name, kind, tag, date or folder; 10,000 files answer in about 8 ms. ⇧⌘F (Ctrl+Shift+F) searches everything from anywhere in it.
  - **Tags, collections and saved searches** refer to files, never copy them.
  - **Files** in Zen's own Library panel and in the address bar search the same index.
  - A scan of a large folder shows in the sidebar and can be stopped.
- **Tidy names:** proposed clearer names for downloads and files, each reviewed before anything changes. Renames never overwrite, keep compound extensions, refuse files that changed meanwhile, and can be undone after a restart. Firefox's download list follows. Move to Trash uses the system's Trash, never a permanent delete.
- **Auto-archive** (off until chosen): tabs unused for 12 hours to a week close into the Library's Archive, in every space. Pinned tabs, Essentials, tabs playing sound, unsaved work and Tor tabs stay. An archived tab opens again in its own space and container.
- **Arc-style helpers:**
  - `!w`, `!gh`, `!osm`, `!mdn`, `!yt` site shortcuts in the address bar (off until chosen; replaced by bangs in 0.5);
  - Save to Clippings: a selected quote and its source into a note;
  - pause blocking for one tab, until it closes;
  - Ctrl+Tab goes to the tab used last;
  - the start page links to Zen's keyboard shortcut settings.
- **Assist** (off until chosen): tidy tab titles and group tabs by site into folders, both with undo. Ask about this page shows the passages that answer; with the local AI on (MiniCPM5 2B on this computer) it answers with citations. It can summarise a link. It never reads passwords, hidden fields or Tor tabs, and nothing a page says can make it act.
- **Boards** (off until chosen): gather links, quotes and notes into topics. "Add to Board" in a page's menu adds the link, the selected words with their page, or the page; the board page shows cards with clickable links and tickable tasks, and exports as Markdown or a web page that runs nothing. Each board is a sticky note, so it syncs with textarea.
- **Quick window** (off until chosen): a link opened from another app gets a small window of its own, apart from your spaces. "Move tabs to" on its space name keeps it.
- **Ask about this page** shows the passages that answer at once; the local AI's written answer follows when it is ready.
- **Export and import** (start page settings): spaces with their tabs, folders, splits and containers; collections and saved searches; settings, in one JSON file you save. Tor and private tabs, folder paths and passwords in addresses are left out. An import shows every address before it adds anything, and never downloads a feature.

## 0.3.0

- **Search goes to SearXNG by default:** searx.ononoki.org, then priv.au, then Brave Search. A search the first one refuses (blocked, rate-limited, down or unreachable) is loaded again on the next with the same words. The address bar uses the start page's choice too.
- **Features, all off until you turn them on** (start page → Features). The big ones are downloaded only then, pinned by SHA-256, and turning them off deletes the download:
  - **Sticky note:** a small square note from its own toolbar button. Notes are markdown files, kept in Xiao or in a folder you pick, such as the one textarea's Folder sync uses, so both apps share them. It can open the note for the site you are on.
  - **Sort my notes by voice** (1.8 GB): speak, and Whisper small and MiniCPM5 2B, running on this computer, sort what you said and your sticky notes into a board of topics, tasks done and to do, and open questions. The board is saved as a sticky note.
  - **File converter** (184 MB): convert-gitguy268, offline, from Xiao's button.
  - **PDF tools** (0.3 MB): pages per sheet, booklets, page numbers, crop, title and author, add or remove a password, attach files. Firefox's own viewer already highlights, signs and reorders pages, and the converter merges, splits and compresses.
  - **Tab sleep:** tabs unused for 15 minutes to two hours give their memory back.
- Downloads live in Xiao's app folder (Firefox's content sandbox reads nothing else) and move with it when Xiao is rebuilt after a Zen update.

## 0.2.0 (unreleased)

- **Blocking is built into the browser.** Xiao no longer uses an extension. Its code ships inside its own copy of Zen and is loaded by Firefox's AutoConfig. Ad and tracker blocking, cosmetic filtering, Tor routing, the start page and the toolbar button all run there. There is no add-on to disable, and add-on signing stays on.
- **Less memory.** With six busy sites open (medians of three runs):
  - The add-on process holds 39 MB instead of 290 MB after Firefox frees memory, and 40 MB instead of 1,135 MB before.
  - The whole browser uses 2,179 MB instead of 3,193 MB after a minute, and 1,821 MB instead of 2,026 MB after freeing memory.
  - The filter engine is now prebuilt by Xiao rather than built in the browser, and is refreshed daily from a GitHub release (hash checked).
- **Tor is routed by the browser itself**, before session restore and for every request a Tor tab makes (service workers and favicons included). Each site's connections are isolated, so "New Tor circuit" takes effect at once.
- **Xiao Search** (`--search`, macOS and Linux): Xiao's own SearXNG on 127.0.0.1:8890, in Xiao's style, running only while Xiao runs. It replaces the start page's hard-coded 127.0.0.1:8888.
- **The start page is easier to reach:**
  - Ctrl+T and the + button open it, instead of Zen's floating address bar.
  - Xiao starts on it.
  - Its settings can switch either back: "A new tab opens" and "When Xiao starts".
- **A cleaner look:**
  - Bricolage Grotesque and Junicode italic, as on zen-browser.app, on the start page, the website and Zen's own UI.
  - The name is now written "Xiao", and the app is ~/Applications/Xiao.app.
  - The mark appears once: on the toolbar button. It's gone from the start page and the tab.
  - The extensions button is hidden while no extensions are installed.
- Speed and memory settings (`shared/prefs/speed.yaml`): one spare web process instead of three, idle tabs unloaded sooner, pages drawn a little sooner.
- **Removed:** the `--ubo` option. The installer removes 0.1's extension and the uBlock Origin it added. Start-page links and settings reset once.
- **Linux and Windows kits** now keep their own copy of Zen too, rebuilt when Zen updates. Zen's Flatpak can't be copied; use Zen's tarball.
- **Website** laid out like zen-browser.app: a live start page, a feature tour, release notes with an RSS feed, and favicons.

## 0.1.0 (unreleased)

- Kit for Zen on macOS, Windows and Linux: own profile, 79 hardening settings (plus 10 in strict mode), launcher.
- Extension: offline start page, toolbar popup, Ghostery ad and tracker blocking with cosmetic filtering and a per-site switch.
- Tor container: Tor tabs through the kit's Tor, a circuit per site, no WebRTC, fails closed when Tor stops.
- Fork overlay for Zen 1.23.3b: renamed to xiao, own branding, no updater, extension built in; Linux build workflow.
- Website for GitHub Pages.
- Red branding (`#e70923`, crimson to orange-red mark) across the app icons, start page, popup, website and Zen's own accent colour. Design rules in DESIGN.md.
- macOS kit: xiao.app is now a copy of Zen.app with xiao's name, icon, menus and About dialog. When Zen.app updates, xiao rebuilds the copy at its next start.
- Ads requested by a site's service worker are now blocked too.
- Popup: "New Tor circuit for this site" in Tor tabs; switching blocking off or on reloads the page.
- Filter lists that fail to download (offline at first start) are tried again after 1, 5 and 15 minutes; the blocked count is saved within seconds.
- Windows installer refuses to run while xiao is open, like the macOS and Linux one.
- Linux kit: xiao gets its own window class (`--class xiao`); Windows shortcut uses xiao's icon.
