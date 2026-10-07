// strength.js - the single six-level strength scale shared by all three tabs.
//
// Categories: 0 Very weak | 1 Weak | 2 Medium | 3 Good | 4 Strong | 5 Very strong
// Boundaries in bits (ascending): 35, 45, 55, 65, 80.
//
// IMPORTANT: the tabs get their bits from two deliberately different models.
//   * Generated password / passphrase: the bits are GENERATION ENTROPY, computed from
//     the known random generation process (see candidateBits/qualityForBits in app.js).
//   * Password Check: the generation process of an existing password is unknown, so
//     its bits are only the bit-equivalent of the ESTIMATED GUESSES (log2(guesses)).
//     That value is used here for classification only and is never displayed as
//     entropy; the checker keeps showing "estimated guesses: ~10^N".
// This module only classifies a bit value. It never computes entropy and never
// estimates guesses, so it cannot be mistaken for either model.
(function () {
  "use strict";

  const LEVELS = ["very-weak", "weak", "medium", "good", "strong", "very-strong"];
  const KEYS = {
    "very-weak": "quality.veryWeak", weak: "quality.weak", medium: "quality.medium",
    good: "quality.good", strong: "quality.strong", "very-strong": "quality.veryStrong"
  };
  const FILL = { "very-weak": 1, weak: 2, medium: 3, good: 4, strong: 5, "very-strong": 6 };
  const THRESHOLDS = [35, 45, 55, 65, 80];

  function levelForBits(bits) {
    let index = 0;
    while (index < THRESHOLDS.length && bits >= THRESHOLDS[index]) index++;
    return LEVELS[index];
  }

  // Bit-equivalent difficulty of an actual estimated-guess count: log2(guesses).
  // Used for classification only; the value is never displayed and never called entropy.
  function bitsFromGuesses(guesses) { return Math.log2(guesses); }

  // Fills a six-segment meter: data-fill=N colours the first N segments (see app.css).
  function fillMeter(element, level) {
    if (!element) return;
    element.setAttribute("data-fill", String(FILL[level] || 0));
  }

  window.PWGEN_STRENGTH = {
    LEVELS: LEVELS, KEYS: KEYS, FILL: FILL, THRESHOLDS: THRESHOLDS,
    levelForBits: levelForBits, bitsFromGuesses: bitsFromGuesses, fillMeter: fillMeter,
    keyFor: function (level) { return KEYS[level]; },
    fillFor: function (level) { return FILL[level]; }
  };
})();
