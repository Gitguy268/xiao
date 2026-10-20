# The Xiao fork overlay

This folder turns a checkout of [zen-browser/desktop](https://github.com/zen-browser/desktop) at the tag in `ZEN_TAG` into Xiao. It is an overlay, not a copy of Zen: the repository stays small, and moving to a new Zen release means changing one line and fixing whatever the overlay reports.

## What it changes

| | |
| --- | --- |
| Identity | `surfer.json` name and vendor become `Xiao`, the app id and binary `xiao`; `MOZ_APP_BASENAME` and the distribution id change too, so Xiao never shares Zen's profile folder or macOS bundle id. The twilight brand is removed. |
| Updates | `--disable-updater`. Zen's update server and signing key are Zen's, not Xiao's. |
| Branding | `branding/release/`, rendered from `branding/source/*.svg` by `branding/make.sh` (which also writes the kit's icons). Zen's accent colour comes from `shared/prefs/look.yaml`. See [DESIGN.md](../DESIGN.md). |
| Settings | `shared/prefs/balanced.yaml`, `speed.yaml`, `look.yaml` and `prefs/fork.yaml` go to `prefs/xiao/`. Zen's prefs tool sorts everything by name and reads folders in no fixed order, so the overlay deletes Zen's own entry for every pref Xiao sets. |
| Links | Zen's donate, about, privacy and uninstall-feedback links point to Xiao's site or issue tracker. Zen's mods marketplace and link sharing are kept and still use Zen's servers when you use them. |
| Xiao's code | With `--engine`, after `npm run import`: `dist/core` goes to `engine/browser/xiao/` and is installed next to the app as the `xiao` folder, with `xiao.cfg` and `defaults/pref/autoconfig.js`, the same AutoConfig loader the kit uses. The package manifest lists them. No page opens by itself on first run. |

## Build it

```sh
npm ci && npm run build                     # in xiao: builds dist/core and dist/loader
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

- Checked on 2026-10-19: the overlay applies to Zen 1.23.3b, all 263 Zen patches import on top of it, and Zen's prefs tool accepts Xiao's settings and writes each one once.
- Checked on 2026-10-20: the engine step writes Xiao's code, the loader, the `DIRS` entry and the package-manifest lines against Firefox's own `browser/moz.build` and `package-manifest.in`. The same loader and code pass the kit's 34 checks on Zen 1.23.3b.
- Not yet checked: a full compile. That is what `fork-build.yml` is for.
- Not done yet:
  - Windows and macOS builds. Zen cross-compiles both from Linux; the workflow will follow Zen's once the Linux build passes.
  - Built-in Tor. Tor tabs work in a build only if a tor is listening on 127.0.0.1:9160. The plan is to ship the Tor Expert Bundle inside the app and start it from a small module, the way Tor Browser's tor-launcher does.
  - Safe Browsing in builds needs a Google API key, which this repository doesn't have.
