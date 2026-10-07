// checker.js - local password strength check for the "Password Check" tab.
//
// Privacy: the value typed into the check input is analysed entirely in this
// closure. It is never sent anywhere, never stored, never logged, never copied to
// the clipboard and never written into a DOM attribute or URL. Only derived
// results (rating, order-of-magnitude guess count, pattern keys) are rendered,
// and only through the existing i18n helper. Leaving the tab clears everything.
//
// Scope: this estimator is deliberately SEPARATE from the generator's entropy
// model (qualityForBits / candidateBits in app.js). PWGen knows the random
// generation process for the values it generates; an arbitrary existing password
// has an unknown history, so this checker stays conservative and reports an
// order-of-magnitude guess estimate instead of any exact figure or crack time.
//
// Model (zxcvbn-inspired, implemented from scratch, no dependency):
//   * the password is decomposed into pattern matches (dictionary, leet, reversed,
//     sequence, repeat, keyboard, year/date, separator) plus brute-force spans;
//   * a small dynamic program finds the cheapest decomposition (fewest estimated
//     guesses) and that cost is compared against whole-string brute force;
//   * the result is reported as an order of magnitude (~10^N) only.
(function () {
  "use strict";

  const MAX_LENGTH = 256;            // hard input maximum, the whole accepted value is analysed
  const WORD_POOL = 1000;            // conservative: a human-chosen word is assumed to come from ~1000 common words
  const MIN_WORD_LENGTH = 3;
  const MAX_WORD_LENGTH = 14;
  const MAX_GUESSES = 1e30;          // cap: displayed only as an order of magnitude
  const DEBOUNCE_MS = 120;           // keeps typing responsive

  // Common passwords, roughly ordered by popularity (rank drives the guess cost).
  const COMMON_PASSWORDS = (
    "123456 password 12345678 qwerty 123456789 12345 1234 111111 1234567 dragon 123123 baseball abc123 football " +
    "monkey letmein 696969 shadow master 666666 qwertyuiop 123321 mustang 1234567890 michael 654321 pussy " +
    "superman 1qaz2wsx 7777777 fuckme 121212 000000 qazwsx 123qwe killer trustno1 jordan jennifer zxcvbnm " +
    "asdfgh hunter buster soccer harley batman andrew tigger sunshine iloveyou fuckyou 2000 charlie robert " +
    "thomas hockey ranger daniel starwars klaster 112233 george asshole computer michelle jessica pepper " +
    "1111 zxcvbn 555555 11111111 131313 freedom 777777 pass fuckmylife maggie 159753 aaaaaa ginger princess " +
    "joshua cheese amanda summer love ashley 6969 nicole chelsea biteme matthew access yankees 987654321 dallas " +
    "austin thunder taylor matrix william corvette hello martin heather secret fucker merlin diamond 1234qwer " +
    "gfhjkm hammer silver 222222888888 anthony justin test bailey q1w2e3r4t5 patrick internet scooter orange " +
    "11111 golfer cookie richard samantha bigdog guitar jackson whatever mickey chicken sparky snoopy maverick " +
    "phoenix camouflage sexy peanut morgan welcome falcon cowboy ferrari samsung andrea smoky steelers joseph " +
    "mercedes dakota arsenal eagles melissa boomer boomerang spider nascar monster tigers yellow xxx123 gateway " +
    "marina diablo bulldog qwer1234 compaq purple hardcore banana junior hannah 123654 888888 liverpool " +
    "jelszo jelszó admin administrator root guest changeme letme1n p@ssw0rd passw0rd"
  ).split(/\s+/);

  // Common words used for "word-like" detection (English/international basics plus a
  // few frequent Hungarian words; the project's own Hungarian word list is also used).
  const COMMON_WORDS = (
    "the and for you that with have this from they will would there their what about which when make like time " +
    "just know take people into year your good some could them other than then now look only come over think " +
    "also back after work first well even want give most used find here thing many life still being every great " +
    "might where those while never under world house place water light night small large early young long short " +
    "right wrong happy angry beauty summer winter spring autumn morning evening today tomorrow yesterday week month " +
    "year today number letter word name city town country road street school student teacher doctor nurse driver " +
    "police fire water earth wind storm cloud rain snow sun moon star sky sea river lake mountain forest garden " +
    "flower tree grass bird horse dog cat mouse fish tiger lion bear wolf fox sheep goat cow pig duck goose " +
    "apple bread cheese milk coffee tea sugar salt pepper butter fruit orange banana grape lemon melon cherry " +
    "music movie book paper table chair window door wall floor roof kitchen bedroom bathroom garden garage " +
    "phone screen keyboard mouse laptop camera picture video radio television newspaper magazine story poem song " +
    "correct horse battery staple curious window secret shadow dragon monkey silver golden thunder hunter " +
    "freedom wisdom patience courage honest simple clever gentle quiet bright warm colour color dream hope peace " +
    "strong safe trust fresh clear smart happy lucky swift brave calm proud honest fair kind nice real true " +
    "hungary hungarian magyar budapest europe european world global local private secure random entropy " +
    "passphrase password generator checker strength weakness pattern repeat sequence year date digit symbol " +
    "keyboard qwerty admin login account user access master root system network server client browser website"
  ).split(/\s+/);

  const LEET = {
    "@": "a", "4": "a", "8": "b", "(": "c", "{": "c", "3": "e", "6": "g", "9": "g",
    "1": "i", "!": "i", "|": "l", "0": "o", "$": "s", "5": "s", "7": "t", "+": "t", "2": "z"
  };
  const SEQUENCES = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    keyboardRow1: "qwertyuiop",
    keyboardRow2: "asdfghjkl",
    keyboardRow3: "zxcvbnm",
    keyboardColumn1: "qaz",
    keyboardColumn2: "wsx",
    keyboardColumn3: "edc",
    keyboardColumn4: "rfv",
    keyboardColumn5: "tgb",
    keyboardColumn6: "yhn",
    keyboardColumn7: "ujm"
  };
  const CHARSET_SIZE = { lower: 26, upper: 26, digit: 10, symbol: 33, other: 100 };

  const commonPasswordRanks = new Map();
  COMMON_PASSWORDS.forEach((word, index) => { if (!commonPasswordRanks.has(word)) commonPasswordRanks.set(word, index + 1); });
  const commonWords = new Set(COMMON_WORDS);

  let hungarianSet = null;
  function hungarianWords() {
    if (hungarianSet === null) {
      hungarianSet = new Set();
      const list = window.HU_WORDS;
      if (Array.isArray(list)) for (const word of list) hungarianSet.add(String(word).toLowerCase());
    }
    return hungarianSet;
  }

  // ---------------------------------------------------------------- helpers

  function charsetSize(text) {
    let size = 0, hasLower = false, hasUpper = false, hasDigit = false, hasSymbol = false, hasOther = false;
    for (const ch of text) {
      if (ch >= "a" && ch <= "z") hasLower = true;
      else if (ch >= "A" && ch <= "Z") hasUpper = true;
      else if (ch >= "0" && ch <= "9") hasDigit = true;
      else if (/[ -/:-@[-`{-~]/.test(ch)) hasSymbol = true;
      else hasOther = true;
    }
    if (hasLower) size += CHARSET_SIZE.lower;
    if (hasUpper) size += CHARSET_SIZE.upper;
    if (hasDigit) size += CHARSET_SIZE.digit;
    if (hasSymbol) size += CHARSET_SIZE.symbol;
    if (hasOther) size += CHARSET_SIZE.other;
    return Math.max(size, 1);
  }

  // Brute-force model. ONE effective character-set size is derived from the whole
  // accepted password and used for every unmatched span. Because that size is the
  // same everywhere, splitting an unmatched span into smaller unmatched spans can
  // never reduce its cost (size^a * size^b === size^(a+b)): the estimator must not
  // profit from knowing the character class of each individual position, which an
  // attacker does not know either. Only a real pattern match can make a region
  // cheaper than brute force.
  function bruteforceGuesses(text, charset) {
    return Math.pow(charset, text.length);
  }

  function leetDecode(text) {
    let out = "", substitutions = 0;
    for (const ch of text) {
      const mapped = LEET[ch];
      if (mapped) { out += mapped; substitutions++; } else out += ch;
    }
    return { decoded: out, substitutions };
  }

  // ---------------------------------------------------------------- matchers

  // Dictionary: common passwords (ranked), common words and the Hungarian word list,
  // also tried through leet substitution, case folding and reversal.
  function dictionaryMatches(password, start) {
    const matches = [];
    const maxLength = Math.min(MAX_WORD_LENGTH, password.length - start);
    for (let length = MIN_WORD_LENGTH; length <= maxLength; length++) {
      const raw = password.substr(start, length);
      const lower = raw.toLowerCase();
      const leet = leetDecode(lower);
      const candidates = [
        { word: lower, substitutions: 0, reversed: false },
        { word: leet.decoded, substitutions: leet.substitutions, reversed: false },
        { word: [...lower].reverse().join(""), substitutions: 0, reversed: true }
      ];
      for (const candidate of candidates) {
        if (candidate.word.length < MIN_WORD_LENGTH) continue;
        const rank = commonPasswordRanks.get(candidate.word);
        const known = rank !== undefined || commonWords.has(candidate.word) || hungarianWords().has(candidate.word);
        if (!known) continue;
        let guesses = rank !== undefined ? rank : WORD_POOL;
        if (candidate.substitutions > 0) guesses *= Math.pow(2, candidate.substitutions);
        if (candidate.reversed) guesses *= 2;
        matches.push({
          start, end: start + length, kind: "dictionary", word: candidate.word,
          common: rank !== undefined, substitutions: candidate.substitutions, reversed: candidate.reversed,
          guesses
        });
      }
    }
    return matches;
  }

  function sequenceMatches(password, start) {
    const matches = [];
    for (const [name, sequence] of Object.entries(SEQUENCES)) {
      const maxLength = Math.min(sequence.length, password.length - start);
      for (let length = 3; length <= maxLength; length++) {
        const raw = password.substr(start, length);
        const forward = sequence.indexOf(raw);
        const backward = [...sequence].reverse().join("").indexOf(raw);
        if (forward < 0 && backward < 0) continue;
        matches.push({
          start, end: start + length, kind: "sequence", sequence: name,
          guesses: sequence.length * length * 2
        });
      }
    }
    return matches;
  }

  // Cheapest known cost of a short string: brute force (with the global effective
  // character set) or its single best pattern match. Used for repeated blocks, so
  // "abcabcabc" is recognised as a cheap pattern rather than three random letters.
  function cheapestGuesses(text, charset) {
    const candidates = []
      .concat(dictionaryMatches(text, 0))
      .concat(sequenceMatches(text, 0))
      .concat(yearMatches(text, 0));
    let best = bruteforceGuesses(text, charset);
    for (const candidate of candidates) if (candidate.end === text.length && candidate.guesses < best) best = candidate.guesses;
    return best;
  }

  // Runs of common word separators (space, dash, underscore, dot, ...). Human
  // passphrase separators are highly predictable, so they are modelled as a small
  // alphabet instead of as arbitrary brute-force characters. This keeps multi-word
  // passphrase input conservative without affecting mixed random strings, which
  // rarely contain such a character.
  const SEPARATOR_CHARS = /[ \-_.,;:|+/]/;
  function separatorMatches(password, start) {
    const matches = [];
    const remaining = password.length - start;
    for (let length = 1; length <= remaining && length <= 4; length++) {
      if (!SEPARATOR_CHARS.test(password[start + length - 1])) break;
      matches.push({ start, end: start + length, kind: "separator", guesses: Math.pow(10, length) });
    }
    return matches;
  }

  function repeatMatches(password, start, charset) {
    const matches = [];
    const remaining = password.length - start;
    // repeated single character
    let run = 1;
    while (run < remaining && password[start + run] === password[start]) run++;
    if (run >= 3) matches.push({ start, end: start + run, kind: "repeatChar", guesses: charsetSize(password[start]) * run });
    // repeated substring
    for (let period = 1; period <= Math.floor(remaining / 2); period++) {
      const base = password.substr(start, period);
      let repeats = 1;
      while (start + (repeats + 1) * period <= password.length &&
             password.substr(start + repeats * period, period) === base) repeats++;
      if (repeats < 2 || period * repeats < 4) continue;
      matches.push({
        start, end: start + period * repeats, kind: "repeatBlock", period, repeats,
        guesses: cheapestGuesses(base, charset) * repeats
      });
    }
    return matches;
  }

  function yearMatches(password, start) {
    const matches = [];
    const four = password.substr(start, 4);
    if (/^(19|20)\d\d$/.test(four)) matches.push({ start, end: start + 4, kind: "year", guesses: 100 });
    const eight = password.substr(start, 8);
    if (/^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(eight) ||
        /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d\d$/.test(eight)) {
      matches.push({ start, end: start + 8, kind: "date", guesses: 20000 });
    }
    // Dates written with a separator (2026-06-15, 15.06.2026, ...) are just as
    // predictable, so they are matched too; the separator choice costs a little more.
    for (const size of [10, 9]) {
      const window = password.substr(start, size);
      if (window.length < size) continue;
      if (/^(19|20)\d\d[.\-_/ ](0?[1-9]|1[0-2])[.\-_/ ](0?[1-9]|[12]\d|3[01])$/.test(window) ||
          /^(0?[1-9]|[12]\d|3[01])[.\-_/ ](0?[1-9]|1[0-2])[.\-_/ ](19|20)\d\d$/.test(window)) {
        matches.push({ start, end: start + size, kind: "date", guesses: 20000 * 100 });
        break;
      }
    }
    return matches;
  }

  // NOTE: there is deliberately no generic "digit run" matcher here. Pricing every
  // run of three or more digits as 10^length would hand the estimator knowledge an
  // attacker does not have (that those positions contain digits) and would partly
  // reintroduce the brute-force segmentation problem. Genuine numeric patterns stay
  // cheap through the other matchers: sequences (123, 987), years and dates (2026,
  // 2026-06-15), repeats (111111). An all-digit password is priced with the digit
  // alphabet by the global brute-force cardinality, so numeric-only input is still
  // modelled conservatively without special-casing.

  function allMatches(password, charset) {
    const byStart = Array.from({ length: password.length }, () => []);
    for (let start = 0; start < password.length; start++) {
      const found = []
        .concat(dictionaryMatches(password, start))
        .concat(sequenceMatches(password, start))
        .concat(repeatMatches(password, start, charset))
        .concat(yearMatches(password, start))
        .concat(separatorMatches(password, start));
      byStart[start] = found;
    }
    return byStart;
  }

  // ---------------------------------------------------------------- decomposition

  function estimate(password) {
    const charset = charsetSize(password);        // one coherent size for all unmatched spans
    const byStart = allMatches(password, charset);
    const n = password.length;
    const best = new Array(n + 1).fill(Infinity);
    const back = new Array(n + 1).fill(null);
    best[0] = 1;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(best[i])) continue;
      for (let j = i + 1; j <= n; j++) {
        const candidate = best[i] * bruteforceGuesses(password.slice(i, j), charset);
        if (candidate < best[j]) { best[j] = candidate; back[j] = { prev: i, match: null }; }
      }
      for (const match of byStart[i]) {
        const candidate = best[i] * match.guesses;
        if (candidate < best[match.end]) { best[match.end] = candidate; back[match.end] = { prev: i, match }; }
      }
    }
    const segments = [];
    for (let at = n; at > 0;) {
      const step = back[at];
      if (!step) break;
      segments.push(step.match || { start: step.prev, end: at, kind: "bruteforce" });
      at = step.prev;
    }
    segments.reverse();

    // The cheapest decomposition found. No extra permutation multiplier is applied:
    // that would inflate the estimate for inputs made of many short (weak) segments.
    let guesses = best[n];
    if (!Number.isFinite(guesses) || guesses < 1) guesses = bruteforceGuesses(password, charset);
    guesses = Math.min(guesses, bruteforceGuesses(password, charset));
    guesses = Math.max(1, Math.min(guesses, MAX_GUESSES));

    return { guesses, exponent: Math.round(Math.log10(guesses)), segments, byStart };
  }

  // ---------------------------------------------------------------- rating

  // Six levels, matching the scale already used by the other two tabs.
  function ratingForExponent(exponent) {
    if (exponent < 5) return "very-weak";
    if (exponent < 8) return "weak";
    if (exponent < 11) return "medium";
    if (exponent < 14) return "good";
    if (exponent < 18) return "strong";
    return "very-strong";
  }

  const RATING_KEYS = {
    "very-weak": "quality.veryWeak", weak: "quality.weak", medium: "quality.medium",
    good: "quality.good", strong: "quality.strong", "very-strong": "quality.veryStrong"
  };
  const RATING_FILL = { "very-weak": 1, weak: 2, medium: 3, good: 4, strong: 5, "very-strong": 6 };

  // ---------------------------------------------------------------- findings

  // Only findings that actually apply are produced. The estimator never quotes the
  // password (or any fragment of it) back into the page.
  function findings(password, result, rating) {
    const kinds = new Set(result.segments.map(segment => segment.kind));
    // Two different views of the selected decomposition:
    //   patternSegments - every pattern actually used by the estimator (including
    //                     separators), used for the "no known pattern" statement;
    //   matches         - major weakness patterns only (separators excluded), used
    //                     for the predictable-coverage gate on positive findings.
    const patternSegments = result.segments.filter(segment => segment.kind !== "bruteforce");
    const matches = patternSegments.filter(segment => segment.kind !== "separator");
    const words = matches.filter(match => match.kind === "dictionary" && !match.common);
    const lengths = [...password].length;
    const strengths = [], weaknesses = [];
    const has = kind => kinds.has(kind);

    // Positive findings are shown only when they are actually meaningful: the
    // password must not be mostly explained by known patterns (coverage) and must
    // not be a common password, and the estimate must already be at least "Közepes".
    // A short mixed-character password is therefore not praised for "full character
    // set", and a long predictable word+year string is not praised for its length.
    const coverage = lengths ? matches.reduce((sum, match) => sum + (match.end - match.start), 0) / lengths : 0;
    const mostlyPredictable = matches.some(match => match.common) || coverage >= 0.5;
    const strongEnough = (RATING_FILL[rating] || 0) >= RATING_FILL.medium;
    // Character-class diversity is only reported once the estimate is genuinely
    // strong: mixing cases/digits/symbols is not itself a strength.
    const clearlyStrong = (RATING_FILL[rating] || 0) >= RATING_FILL.good;

    if (lengths >= 16 && !mostlyPredictable) strengths.push("check.find.goodLength");
    if (!mostlyPredictable && strongEnough && !has("repeatChar") && !has("repeatBlock")) strengths.push("check.find.noRepetition");
    if (words.length >= 3 && strongEnough) strengths.push("check.find.multiWordPhrase");
    if (!mostlyPredictable && clearlyStrong && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password)) {
      strengths.push("check.find.fullCharacterSet");
    }
    if (!patternSegments.length) strengths.push("check.find.noPatterns");

    if (lengths < 12) weaknesses.push("check.find.shortLength");
    if (/^\d+$/.test(password)) weaknesses.push("check.find.onlyDigits");
    if (matches.some(match => match.common)) weaknesses.push("check.find.commonPassword");
    if (words.length && !matches.some(match => match.common)) weaknesses.push("check.find.commonWord");
    if (has("year") || has("date")) weaknesses.push("check.find.yearSuffix");
    if (has("sequence")) weaknesses.push("check.find.keyboardOrSequence");
    if (has("repeatChar") || has("repeatBlock")) weaknesses.push("check.find.repetition");
    if (matches.some(match => match.substitutions > 0)) weaknesses.push("check.find.leetSubstitution");
    // A numeric suffix is only reported as a structural observation when the
    // decomposition also contains another pattern (typically a dictionary word). The
    // arbitrary digits themselves are never priced as a pattern.
    if (/\d{2,}$/.test(password) && matches.length) weaknesses.push("check.find.trailingDigits");
    if (/^[a-z]+$/.test(password) && lengths >= 12) weaknesses.push("check.find.singleCase");

    // check.rec.ok may only be shown when no meaningful weakness was detected: the
    // final branch cannot return it while weaknesses exist.
    let recommendation;
    if (weaknesses.includes("check.find.commonPassword")) recommendation = "check.rec.notCommon";
    else if (weaknesses.includes("check.find.commonWord") || weaknesses.includes("check.find.yearSuffix") ||
             weaknesses.includes("check.find.trailingDigits") || weaknesses.includes("check.find.leetSubstitution")) recommendation = "check.rec.avoidPredictable";
    else if (weaknesses.includes("check.find.onlyDigits")) recommendation = "check.rec.digitsOnly";
    else if (weaknesses.includes("check.find.repetition") || weaknesses.includes("check.find.keyboardOrSequence")) recommendation = "check.rec.avoidPatterns";
    else if (weaknesses.includes("check.find.singleCase")) recommendation = "check.rec.lowVariety";
    else if (weaknesses.includes("check.find.shortLength")) recommendation = "check.rec.lengthen";
    else recommendation = weaknesses.length ? "check.rec.avoidPredictable" : "check.rec.ok";

    const wordUncertainty = words.length >= 2;
    return { strengths, weaknesses, recommendation, wordUncertainty };
  }

  // ---------------------------------------------------------------- DOM wiring

  const input = document.getElementById("check-input");
  const toggle = document.getElementById("check-toggle");
  const emptyState = document.getElementById("check-empty");
  const results = document.getElementById("check-result");
  const meter = document.getElementById("check-meter");
  const quality = document.getElementById("check-quality");
  const guessesOut = document.getElementById("check-guesses");
  const lengthOut = document.getElementById("check-length");
  const strengthsOut = document.getElementById("check-strengths");
  const weaknessesOut = document.getElementById("check-weaknesses");
  const recommendationOut = document.getElementById("check-recommendation");
  const uncertaintyOut = document.getElementById("check-uncertainty");
  const limitNote = document.getElementById("check-limit-note");

  let analysed = null;       // { exponent, rating, lengths, findings } - never the password
  let timer = null;

  function renderList(element, keys) {
    element.textContent = "";
    const list = keys.length ? keys : ["check.noneFound"];
    for (const key of list) {
      const item = document.createElement("li");
      item.textContent = t(key);
      element.appendChild(item);
    }
  }

  function render(result) {
    analysed = result;
    emptyState.hidden = true;
    results.hidden = false;
    quality.textContent = t(RATING_KEYS[result.rating]);
    quality.className = "quality " + result.rating;
    meter.setAttribute("data-fill", String(RATING_FILL[result.rating]));
    meter.setAttribute("aria-hidden", "false");
    meter.setAttribute("aria-label", t("check.meterAria", { rating: t(RATING_KEYS[result.rating]) }));
    guessesOut.textContent = t("check.orderOfMagnitude", { exponent: result.exponent });
    lengthOut.textContent = t("check.lengthValue", { count: result.lengths });
    renderList(strengthsOut, result.strengths);
    renderList(weaknessesOut, result.weaknesses);
    recommendationOut.textContent = t(result.recommendation);
    uncertaintyOut.hidden = !result.wordUncertainty;
    limitNote.hidden = result.lengths < MAX_LENGTH;
  }

  // The show/hide label is derived from the current input type, so it follows the
  // UI language without reading or re-rendering any password value.
  function updateToggleLabel() {
    if (!toggle) return;
    const shown = input && input.type === "text";
    toggle.textContent = t(shown ? "check.hide" : "check.show");
    toggle.setAttribute("aria-label", t(shown ? "check.hideAria" : "check.showAria"));
  }

  function reset() {
    if (timer) { clearTimeout(timer); timer = null; }
    analysed = null;
    if (input) input.value = "";
    if (input) input.type = "password";
    if (toggle) toggle.setAttribute("aria-pressed", "false");
    updateToggleLabel();
    if (results) results.hidden = true;
    if (emptyState) emptyState.hidden = false;
    if (meter) { meter.removeAttribute("data-fill"); meter.setAttribute("aria-hidden", "true"); meter.removeAttribute("aria-label"); }
    if (quality) { quality.textContent = ""; quality.className = "quality"; }
    if (guessesOut) guessesOut.textContent = "";
    if (lengthOut) lengthOut.textContent = "";
    if (strengthsOut) strengthsOut.textContent = "";
    if (weaknessesOut) weaknessesOut.textContent = "";
    if (recommendationOut) recommendationOut.textContent = "";
    if (uncertaintyOut) uncertaintyOut.hidden = true;
    if (limitNote) limitNote.hidden = true;
  }

  // Re-renders the visible labels after a language switch, using only the stored
  // derived result. The password is not read, re-analysed or touched here.
  function relabel() {
    updateToggleLabel();
    if (analysed) render(analysed);
  }

  function analyzeNow() {
    if (!input) return;
    let value = input.value;
    if (value.length > MAX_LENGTH) { input.value = value.slice(0, MAX_LENGTH); value = input.value; }
    if (!value.length) { reset(); return; }
    const result = estimate(value);
    const rating = ratingForExponent(result.exponent);
    const derived = findings(value, result, rating);
    render({
      exponent: result.exponent, rating, lengths: [...value].length,
      strengths: derived.strengths, weaknesses: derived.weaknesses,
      recommendation: derived.recommendation, wordUncertainty: derived.wordUncertainty
    });
  }

  function scheduleAnalysis() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; analyzeNow(); }, DEBOUNCE_MS);
  }

  if (input) input.addEventListener("input", scheduleAnalysis);
  if (input) input.addEventListener("change", analyzeNow);
  if (toggle) toggle.addEventListener("click", () => {
    input.type = input.type === "text" ? "password" : "text";
    toggle.setAttribute("aria-pressed", input.type === "text" ? "true" : "false");
    updateToggleLabel();
  });

  reset();

  window.PWGEN_CHECK = { reset, relabel };
})();
