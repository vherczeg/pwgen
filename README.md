# PWGen

Free, browser-based password and Hungarian passphrase generator.

**Live site:** https://pwgen.herczeg.cc/

## What it is

A small static web application that generates random passwords and Hungarian
passphrases (several random words joined by a separator). It runs entirely in the
browser, uses the browser's cryptographically secure random number generator
(`window.crypto.getRandomValues()` with rejection sampling), and generates
multiple candidates with an entropy estimate for each.

## Privacy and security architecture

- Generated passwords and passphrases are never transmitted to or stored by the
  site. Copying a generated value to the clipboard happens locally in the browser.
- No analytics, no cookies, no tracking, no third-party runtime scripts, fonts or
  images. After its own static files have loaded, the app makes no network requests.
- A strict Content Security Policy is delivered via a `<meta>` tag (GitHub Pages
  cannot set response headers): `default-src 'none'; script-src 'self' file:;
  style-src 'self' file:; img-src 'self' data:; font-src 'self'; connect-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'none'`.
- The user interface is localized (Hungarian and English) with `lang/ui/*.js`
  dictionaries; the passphrase word list (`lang/hun.js`) is a separate concept.

## Run locally

The site is fully static. Open `index.html` directly (`file://` is supported), or
serve the directory:

```
python -m http.server 8000
# then open http://localhost:8000/
```

## Word list pipeline

The reusable Python pipeline that builds and verifies the word list is documented
in [tools/README.md](tools/README.md). The production word list itself is
`lang/hun.js` and is the single source of truth for the 16,384 Hungarian words.

## License and provenance

Source and license information for the word list and frequency data:
[tools/wordlist_analysis/stage2/SOURCES-AND-LICENSES.txt](tools/wordlist_analysis/stage2/SOURCES-AND-LICENSES.txt).
