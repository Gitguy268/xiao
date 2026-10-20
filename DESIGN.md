# Design

How xiao looks and why. Five principles, each turned into rules a change can be checked against.

<img src="fork/branding/source/app-icon.svg" width="96" alt="The xiao app icon: a red ring around a red dot on a near-black rounded square.">

## Principles

### Care

People use xiao when privacy matters to them, so nothing about it should be careless.

- Every text and background pair meets WCAG AA (4.5:1). The table below lists the measured ratios.
- `prefers-reduced-motion` turns animation off (`--quick` and `--calm` drop to 0 ms).
- Copy says what xiao does and what it doesn't. The limits (Tor tabs aren't anonymity, Windows is tested only by CI) stay as easy to find as the features.

### Simplify

- One accent colour, `#e70923`, the same in light and dark. One mark. Two typefaces: EB Garamond italic for headings, Inter for everything else.
- Every element has a job. If it doesn't tell the user something or let them do something, it goes.
- Defaults that work without settings. Strict mode is one flag, not a page of switches.

### Unite

The start page, popup, website, kit and fork share one look because they share the same sources:

| Source | Produces |
| --- | --- |
| `shared/tokens.css` | Every colour, font and timing in the extension and the website |
| `fork/branding/source/*.svg` | All app icons via `fork/branding/make.sh`: the fork's PNG, ICO and ICNS set and the kit's `xiao.icns`, `xiao.ico` and `xiao.svg` |
| `extension/icons/xiao.svg` | The bare mark: toolbar, start page, README; copied to `site/public/favicon.svg` |
| `shared/prefs/look.yaml` | Zen's own accent colour, in the kit and the fork |
| `npm run e2e` | The start-page screenshots in `test/e2e/out/`, copied to `site/src/assets/` |

Change the source, then regenerate. Never edit a generated file by hand.

### Trust

- Red is the accent, never the surface. Pages stay warm neutral paper and ink, because a red page reads as an error.
- Tor is always violet (`--tor`), so a Tor tab can never be mistaken for anything else.
- State is never shown by colour alone. Tor being on is written out ("Tor is connected"), not just tinted.
- Zen is credited by name wherever xiao depends on it. xiao doesn't pretend to be more than it is.

### Elevate

xiao should be the easiest private browser to recommend:

- **Compared with Zen:** the same calm browser, with ad and tracker blocking, 79 hardened settings and Tor tabs from the first start.
- **Compared with Brave:** Firefox's engine, no rewards, wallet or sponsored content, and every setting it changes is listed on [one page](https://gitguy268.github.io/xiao/privacy/).
- **Compared with Tor Browser:** everyday speed for most tabs, with Tor one click away for the sites that need it. When anonymity matters, xiao says to use Tor Browser.

## Palette

Taken from [iColorPalette p/601840](https://icolorpalette.com/p/601840):

| | | | | |
| --- | --- | --- | --- | --- |
| `#9e0618` | `#e70923` | `#ff0505` | `#f32500` | `#eb492d` |

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--accent` | `#e70923` | `#e70923` | The mark, primary buttons, focus rings, the toolbar badge, Zen's accent. Fills, borders and rings only, never text. |
| `--accent-ink` | `#ffffff` | `#ffffff` | Text on `--accent` |
| `--pool-a` / `--pool-b` | `#f3c7c8` / `#f5cdc1` | `#44020a` / `#410e06` | The soft glow at the foot of the start page |
| `--tor` | `#7b4fd6` | `#b49af0` | Everything to do with Tor |
| `--paper` / `--ink` | `#eeeee7` / `#1d1d1b` | `#1b1b1b` / `#ececE4` | Page and text |
| Mark gradient | `#e70923` → `#f32500` | | Crimson to orange-red, top to bottom |
| Private-window icon | `#fa8d9a` on `#44020a` | | |

Measured contrast:

| Pair | Ratio | Needs |
| --- | --- | --- |
| White on `--accent` (buttons, badge) | 4.7:1 | 4.5:1, text |
| White on hovered button (`--accent` 88% with black) | 5.8:1 | 4.5:1, text |
| `--accent` against light / dark paper | 4.0:1 / 3.7:1 | 3:1, UI parts and focus rings |
| `--tor` on light / dark paper | 4.6:1 / 7.2:1 | 4.5:1, text |

`--accent` is too light for body text on light paper (4.0:1) and too dark on dark paper (3.7:1), so text is always `--ink`, `--ink-soft` or `--tor`.

## Type

- **EB Garamond italic** for headings and the greeting. It gives the calm, editorial voice.
- **Inter** for UI and body text.
- Both are SIL OFL 1.1 and ship with xiao, so nothing loads from a font CDN.

## The mark

A still dot inside a ring. On its own it's drawn in the red gradient. As an app icon it sits on a near-black rounded square on Apple's 824 px grid inside 1024. The wordmark is "xiao" in lower case, EB Garamond italic.
