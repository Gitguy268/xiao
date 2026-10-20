# Contributing

Thanks for helping with Xiao.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/Gitguy268/xiao/issues/new/choose) and use the template. Say whether you use the kit or a full build, which OS and Zen version, what you did, what you expected and what happened.

Report security problems privately: see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and create a branch from `main`.
2. `npm ci`, then make your change. Keep commits small, each with a clear message.
3. Run the checks below and update the README and the website if behaviour changed. For anything visual, follow [DESIGN.md](DESIGN.md).
4. Open a pull request and fill in the template.

## Checks

```sh
npm test          # unit tests: prefs, Tor routing, request types, start page search and links
npm run build     # dist/core/, dist/kit/, dist/xiao-kit.zip (downloads the filter lists once a day)
npm run e2e       # installs the kit into a throwaway folder and drives a real Zen (needs Zen installed; ZEN=/path/to/zen)
npm run site:build
node test/e2e/site-shots.mjs   # the website in Zen at desktop and phone width, light and dark
node test/e2e/memory.mjs       # how much memory Xiao uses with six busy sites open
```

`npm run e2e` downloads Tor and connects through it (on port 9170, so it runs beside a real Xiao); `E2E_TOR=0` skips that part and `E2E_SEARCH=1` adds Xiao Search. CI runs the same test on macOS, Linux and Windows.

## Where things live

| Path | What |
| --- | --- |
| `shared/prefs/` | The hardening and speed settings, in Zen's YAML format. The kit, the fork and the website's privacy page all read these. |
| `core/` | Xiao's browser code: blocking, Tor routing, the start page, the toolbar button and `chrome.css`. `core/lib/` is the part node tests can import; `core/loader/` is what AutoConfig reads. |
| `kit/` | Installers that make Xiao's copy of an installed Zen, and Xiao Search's style |
| `fork/` | The overlay that turns Zen's source into Xiao |
| `site/` | The website (Astro) |
| `shared/tokens.css`, `fork/branding/source/` | Colours, type and the mark. See [DESIGN.md](DESIGN.md). |

## Licence

Xiao is MPL-2.0. Contributions are accepted under the same licence. A new dependency needs a licence compatible with MPL-2.0 that isn't copyleft beyond MPL (ask first if unsure), and an entry in NOTICE.
