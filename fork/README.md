# The xiao fork overlay

This folder turns a checkout of [zen-browser/desktop](https://github.com/zen-browser/desktop) at the tag in `ZEN_TAG` into xiao. It is an overlay, not a copy of Zen: the repository stays small, and moving to a new Zen release means changing one line and fixing whatever the overlay reports.

## What it changes

| | |
| --- | --- |
| Identity | `surfer.json` name, vendor, app id and binary become `xiao`; `MOZ_APP_BASENAME` and the distribution id change too, so xiao never shares Zen's profile folder or macOS bundle id. The twilight brand is removed. |
| Updates | `--disable-updater`. Zen's update server and signing key are Zen's, not xiao's. |
| Branding | `branding/release/`, rendered from `branding/source/*.svg` by `branding/make.sh` (which also writes the kit's icons). Zen's accent colour comes from `shared/prefs/look.yaml`. See [DESIGN.md](../DESIGN.md). |
| Settings | `shared/prefs/balanced.yaml`, `shared/prefs/look.yaml` and `prefs/fork.yaml` go to `prefs/xiao/`. Zen's prefs tool sorts everything by name and reads folders in no fixed order, so the overlay deletes Zen's own entry for every pref xiao sets (30 at Zen 1.23.3b). |
| Links | Zen's donate, about, privacy and uninstall-feedback links point to xiao's site or issue tracker. Zen's mods marketplace and link sharing are kept and still use Zen's servers when you use them. |
| Extension | With `--engine`, after `npm run import`: `dist/ext` becomes a built-in add-on in `engine/browser/extensions/xiao`. No page opens by itself on first run. |

## Build it

```sh
npm ci && npm run build                     # in xiao: builds dist/ext
sh fork/apply.sh fork/build/desktop         # clones Zen at ZEN_TAG and applies the overlay
cd fork/build/desktop
npm ci
npm run download                            # Firefox source, ~800 MB download, ~8 GB unpacked
npm run import                              # Zen's 263 patches (use Node 22, as Zen's .nvmrc says)
node ../../overlay.mjs . --engine
npm run bootstrap && npm run build          # needs full Xcode on macOS, and 30+ GB free
cd engine && ./mach package
```

On macOS, surfer needs GNU tar (`brew install gnu-tar`).

[`.github/workflows/fork-build.yml`](../.github/workflows/fork-build.yml) does the same on a free GitHub runner for Linux x86_64, without LTO or PGO.

## Status

- Checked on 2026-10-19: the overlay applies to Zen 1.23.3b, all 263 Zen patches import on top of it, Zen's prefs tool accepts xiao's settings and writes each one once, and the engine step registers the extension.
- Not yet checked: a full compile. That is what `fork-build.yml` is for.
- Not done yet:
  - Windows and macOS builds. Zen cross-compiles both from Linux; the workflow will follow Zen's once the Linux build passes.
  - Built-in Tor. The extension's Tor tabs work in a build only if a tor is listening on 127.0.0.1:9160. The plan is to ship the Tor Expert Bundle inside the app and start it from a small module, the way Tor Browser's tor-launcher does.
  - Safe Browsing in builds needs a Google API key, which this repository doesn't have.
