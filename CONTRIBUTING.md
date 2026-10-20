# Contributing

Thanks for helping with xiao.

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
npm test          # unit tests: prefs, Tor routing, address bar, adblock contract
npm run build     # dist/xiao.xpi, dist/kit/, dist/xiao-kit.zip
npm run e2e       # installs the kit into a throwaway folder and drives a real Zen (needs Zen installed; ZEN=/path/to/zen)
npm run site:build
```

`npm run e2e` downloads Tor and connects through it; `E2E_TOR=0` skips that part. CI runs the same test on macOS, Linux and Windows.

## Where things live

| Path | What |
| --- | --- |
| `shared/prefs/` | The hardening settings, in Zen's YAML format. The kit, the fork and the website's privacy page all read these. |
| `extension/` | Start page, toolbar popup, ad blocking, Tor container |
| `kit/` | Installers for Zen that's already installed |
| `fork/` | The overlay that turns Zen's source into xiao |
| `site/` | The website (Astro) |
| `shared/tokens.css`, `fork/branding/source/` | Colours, type and the mark. See [DESIGN.md](DESIGN.md). |

## Licence

xiao is MPL-2.0. Contributions are accepted under the same licence. A new dependency needs a licence compatible with MPL-2.0 that isn't copyleft beyond MPL (ask first if unsure), and an entry in NOTICE.
