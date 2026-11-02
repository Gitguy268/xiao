# Privacy test results

The EFF's [Cover Your Tracks](https://coveryourtracks.eff.org/), on its public site, in a throwaway home on macOS with Zen 1.23.3b, on 2 November 2026. `node test/e2e/privacy-check.mjs` runs it twice, with a restart between, and `KIT=...` points it at an older build.

| Build | Tracking ads | Invisible trackers | Fingerprint |
| --- | --- | --- | --- |
| Xiao 0.4 | Blocked | Blocked | "Your browser has a unique fingerprint" |
| Xiao 0.5 | Blocked | Blocked | "Your browser has a randomized fingerprint" |

Xiao 0.5 gave the same verdict after a restart. The site's own warning stands: "sophisticated adversaries may still be able to track you to some extent". It's one test on one computer, and it depends on a live site, so it isn't in CI.

What CI and `npm run e2e:new` check locally: audio, canvas and WebGL readings differ between sites and after a restart, stay the same within a session, reach same-site, blank and sandboxed frames, and go back to normal with the per-site switch. Web workers aren't covered.

## Connections

`npm run e2e:audit`, 10 idle minutes in each mode on macOS, on 2 November 2026:

| Mode | HTTP requests beyond this computer | Socket addresses beyond this computer |
| --- | --- | --- |
| Silent | 0 | 0 |
| Normal | 8 hosts, all on the named list | 6 |

The list is in `test/e2e/network-audit.mjs` and the README. The audit starts logging HTTP about a second after launch, while its socket sample runs from the first second; a request in that gap would show only as an address.
