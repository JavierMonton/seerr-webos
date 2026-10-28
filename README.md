# Seerr for LG webOS

Lightweight native app for LG webOS TVs to browse and request Movies & TV Shows from your [Seerr](https://github.com/seerr-team/seerr) server. Plain JS, no build step, remote-control friendly.

- Discover, Movies, TV Shows, Requests, Search
- Filters (sort, multiple genres, multiple platforms, year), infinite scroll
- Request movies and individual seasons; requested state is shown in details and Requests
- English UI; no `language` param is sent (Seerr returns empty results for `/discover/movies|tv` with `language=`)

## Requirements

- Seerr server ≥ 3.5 reachable from the TV (e.g. `http://192.168.1.10:5055`)
- Seerr API key (Seerr → Settings → General)
- LG webOS TV with Developer Mode or root

## Install

### Homebrew Channel (one click, once published)

Seerr will appear in the Homebrew Channel store after the submission below is merged. Then: Homebrew Channel → search Seerr → Install.

### Manual (.ipk)

1. Download the latest `io.github.javiermonton.seerr_*_all.ipk` from Releases.
2. Install with [Device Manager](https://github.com/webosbrew/dev-manager-desktop) or CLI:
   ```
   ares-setup-device -a tv -i "host=TV_IP" -i "port=22" ...
   ares-install --device tv io.github.javiermonton.seerr_*_all.ipk
   ares-launch --device tv io.github.javiermonton.seerr
   ```
3. On the TV open Seerr → Settings, enter Server + API key → Save.

## Develop

```
cd seerr-webos
# edit app.js / style.css / config.js, then:
ares-package . -o /tmp/seerr-pkg --no-minify
ares-install --device tv /tmp/seerr-pkg/io.github.javiermonton.seerr_*_all.ipk
```

`config.js` holds defaults; the key entered on the TV lives only on the TV (`localStorage`). Back it up before reinstalling (uninstall wipes it).

## Publish to Homebrew (one-click install)

1. Push this repo to GitHub (public).
2. Cut a release: push a tag and CI (`.github/workflows/build.yml`) packages the IPK, generates the manifest and attaches both to the Release:
   ```
   git tag v0.6.4 && git push origin v0.6.4
   ```
   Manual alternative:
   ```
   python3 tools/mkmanifest.py seerr-webos/io.github.javiermonton.seerr_*_all.ipk \
     --repo https://github.com/JavierMonton/seerr-webos --out io.github.javiermonton.seerr.manifest.json
   ```
   then attach both files to the release.
3. Fork [webosbrew/apps-repo](https://github.com/webosbrew/apps-repo), copy `packages/io.github.javiermonton.seerr.yml`, open a PR. After merge the app shows up in Homebrew Channel.
