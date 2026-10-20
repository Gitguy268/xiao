# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting form: <https://github.com/Gitguy268/xiao/security/advisories/new>

Include what you found, how to reproduce it, the xiao version, your OS and whether you use the kit or a full build. You should get a reply within a week. Please give the fix time to ship before you publish details.

## Scope

The most useful reports are about:

- a Tor tab that connects without going through Tor (an IP or DNS leak, or WebRTC);
- a website that can use xiao's extension to read or change something it shouldn't;
- a setting in `shared/prefs/` that doesn't do what the privacy page says;
- the installers (`kit/`), the pinned downloads, or the GitHub Actions workflows.

Problems in Zen, Firefox, Tor or the Ghostery engine themselves belong to those projects ([Zen](https://github.com/zen-browser/desktop/security), [Mozilla](https://www.mozilla.org/security/), [Tor](https://support.torproject.org/misc/bug-or-feedback/), [Ghostery](https://github.com/ghostery/adblocker/security)); report them there too and tell us, so xiao can update.

## What xiao does not promise

Tor tabs hide your IP address from sites. They don't give Tor Browser's anonymity: the browser can still be recognised by its fingerprint. Reports that only show this are expected behaviour.

## Supported versions

Only the latest release is supported.
