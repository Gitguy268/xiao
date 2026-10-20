# Changelog

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
