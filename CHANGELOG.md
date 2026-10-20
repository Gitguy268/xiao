# Changelog

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
