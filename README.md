# PWGen

Browser-based password generator, Hungarian passphrase generator and local
password strength check. Plain HTML/CSS/JavaScript: no build step, no runtime
dependencies, and everything runs in the browser — all randomness comes from
`window.crypto.getRandomValues()` (rejection sampling, no modulo bias), and
`Math.random()` is not used anywhere.

**Live site:** https://pwgen.herczeg.cc/

## Password generator

- Generated locally with the browser's CSPRNG. Lowercase and uppercase letters
  are always included; digits and special characters are optional, each with a
  minimum and a maximum ("no limit" is possible).
- Custom special-character set, and optional avoidance of similar-looking
  characters (`I l 1 O 0`).
- **Exact** generation entropy, not an estimate: generation is uniform over every
  password that satisfies the active constraints, and the displayed value is
  `log2` of their exact count — the same space the sampler draws from.

## Passphrase generator

- 16,384 Hungarian words selected by frequency (`lang/hun.js`).
- Several candidates at once, with configurable separators, guaranteed numbers
  and capitalization.
- Optional website requirements: maximum length (a too-long passphrase is
  discarded and redrawn, never truncated), required character classes, no spaces.
- The displayed bits describe the passphrase generation settings and are
  deliberately conservative: filtering by a maximum length is not included.

## Password Check

- Runs entirely on this device; the entered password is never transmitted, stored
  or logged, and leaving the tab clears it.
- Pattern-aware estimate of the number of guesses, shown as an order of magnitude
  (`~10^N`) together with observed strengths, weaknesses and a recommendation; no
  crack time is given.
- This is **not** generation entropy: an existing password has an unknown
  selection process, so only guesses can be estimated.

## Strength display

One shared six-level scale — Very weak, Weak, Medium, Good, Strong, Very strong —
classifies generated values and checked passwords alike. It is an informational
aid, not an official standard; the thresholds live in `strength.js`.

## Languages and theme

Hungarian and English interface; the passphrase word list stays Hungarian in both.
Switching the interface language only re-renders texts and never regenerates a
secret. Light/dark theme follows the operating system or browser preference
(`prefers-color-scheme`) automatically, including live changes, and is not stored.

## Privacy and security

- Generated passwords and passphrases are never transmitted to or stored by the
  site. Copying a generated value to the clipboard happens locally in the browser.
- No analytics, no cookies, no tracking, no third-party runtime scripts, fonts or
  images. After its own static files have loaded, the app makes no network
  requests.
- A strict Content Security Policy is delivered via a `<meta>` tag (GitHub Pages
  cannot set response headers): `default-src 'none'; script-src 'self' file:;
  style-src 'self' file:; img-src 'self' data:; font-src 'self'; connect-src
  'self'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- Password Check is local as well; only derived results (rating, order of
  magnitude, pattern names) are rendered.

## Run locally

The site is fully static. Open `index.html` directly (`file://` is supported), or
serve the directory:

```
python -m http.server 8000
# then open http://localhost:8000/
```

## Project layout

| Path | Purpose |
| --- | --- |
| `app.js` | generation, entropy, settings and UI wiring |
| `checker.js` | local Password Check estimator |
| `strength.js` | shared six-level strength scale |
| `i18n.js` | translation engine and language switcher |
| `lang/ui/` | Hungarian and English interface dictionaries |
| `lang/hun.js` | 16,384-word Hungarian passphrase list |
| `tools/` | documented word-list pipeline |

## Word list pipeline and provenance

The reusable Python pipeline that builds and verifies the word list is documented
in [tools/README.md](tools/README.md). The production word list is `lang/hun.js`
and is the single source of truth for the 16,384 Hungarian words.

Sources and licenses of the dictionary and frequency data:
[tools/wordlist_analysis/stage2/SOURCES-AND-LICENSES.txt](tools/wordlist_analysis/stage2/SOURCES-AND-LICENSES.txt).
