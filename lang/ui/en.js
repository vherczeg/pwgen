// English UI strings – NOT the passphrase word list.
// The word list is a separate file: lang/hun.js (window.HU_WORDS).
// Keys are semantic and language-independent; the HTML reads them through
// data-i18n attributes and JavaScript through t("key", {var}).
// Values may contain {placeholder} interpolation; a few intentionally contain
// inline HTML (<strong>, <code>) and are bound with data-i18n-html.
window.PWGEN_I18N = window.PWGEN_I18N || {};

window.PWGEN_I18N.en = {
  // The language's own name (endonym) – shown in the language list.
  "language.name": "English",
  "language.code": "EN",
  "language.flag": "🇬🇧",
  "language.selectAria": "Select language",
  "language.menuAria": "Available languages",
  "language.currentAria": "Current language: {name}",

  "app.title": "Passphrase & Password Generator",
  "app.subtitle": "Every random choice is made locally, with your browser's secure random number generator.",
  "app.documentTitle": "Hungarian password & passphrase generator | Secure local generation",
  "app.sourceLink": "Source code",
  "app.sourceLinkAria": "Source code on GitHub (opens in a new tab)",

  "tabs.groupAria": "Generator type",
  "tabs.passphrase": "Passphrase",
  "tabs.password": "Password",

  "actions.copy": "Copy",
  "actions.newPassword": "New password",
  "actions.newPassphrase": "New passphrase",
  "actions.close": "Close",

  "password.lengthLabel": "Password length",
  "password.options": "Options",
  "password.numbers": "Digits (0–9)",
  "password.symbols": "Special characters",
  "password.avoidAmbiguous": "Avoid similar-looking characters",
  "password.optionsHelp": "Lowercase and uppercase letters are always included. Avoiding similar-looking characters excludes I, l, 1, O and 0.",
  "password.advanced": "Advanced settings",
  "password.minNumbers": "Minimum digits",
  "password.minSymbols": "Minimum special characters",
  "password.symbolSet": "Allowed special characters",
  "password.symbolSetHelp": "If a website rejects certain characters, simply delete them here. The minimum values apply only when that character type is enabled.",
  "password.bits": "Estimated entropy: {bits} bits",
  "password.needSymbol": "Please enter at least one special character!",
  "password.minGreaterThanLength": "The number of mandatory characters ({count}) is greater than the password length.",

  "passphrase.messageLoading": "Loading word list…",
  "passphrase.candidateCount": "Number of passphrases",
  "passphrase.wordCount": "Number of words",
  "passphrase.separatorCharacters": "Separator characters:",

  "separator.groupAria": "Common separator characters",
  "separator.space": "Space",
  "separator.randomDigitAria": "Use a random digit as separator",
  "separator.help": "At every word boundary a separator is chosen at random from the characters in this field. An empty field means no separator. “123” is the random-digit separator; a standalone digit is not allowed.",

  "settings.guaranteedNumbers": "Guaranteed numbers",
  "settings.capitalization": "Capitalization",
  "settings.websiteRequirements": "Website requirements",

  "numbers.none": "None",
  "numbers.one": "1 number",
  "numbers.two": "2 numbers",
  "numbers.custom": "Custom…",
  "numbers.help": "The selected numbers are guaranteed to appear in the passphrase. The 123 option among the separators is independent of this and may randomly use a digit as a separator.",
  "numbers.blocks": "Number of number blocks",
  "numbers.minDigits": "Min. digits / block",
  "numbers.maxDigits": "Max. digits / block",
  "numbers.blocksHelp": "At most one block is added to a word, at its beginning or end.",

  "capital.none": "None",
  "capital.all": "Every word",
  "capital.one": "One random word",
  "capital.oneUpper": "One random word ALL UPPERCASE",

  "website.maxLength": "Maximum length",
  "website.none": "None",
  "website.custom": "Custom…",
  "website.customMax": "Custom maximum",
  "website.maxHelp": "If a new passphrase is longer than the maximum, the generator discards the whole passphrase and draws a new one. It never truncates an existing passphrase.",
  "website.requires": "The site requires:",
  "website.requiresUpper": "Uppercase letter",
  "website.requiresDigit": "Digit",
  "website.requiresSpecial": "Special character",
  "website.forbids": "The site forbids:",
  "website.forbidsSpace": "Space",

  "how.title": "ⓘ How does it work?",
  "how.lead": "Hungarian word list:",
  "how.bodyPrefix": "the generator uses",
  "how.bodySuffix": "distinct words selected by frequency. Every choice is made locally, with a cryptographically secure random number generator.",

  "summary.none": "None",
  "summary.customNoBlock": "Custom · no block",
  "summary.customBlocks": "Custom · {blocks} block(s) · {digits} digits",
  "summary.max": "Max. {max}",
  "summary.upper": "Uppercase",
  "summary.digit": "Digit",
  "summary.special": "Special",
  "summary.noSpace": "No space",

  "candidate.status": "{bits} bits · {length} characters",
  "compat.ok": "✓ Meets requirements",
  "compat.bad": "⚠ Does not meet requirements",
  "compat.allOk": "✓ Every candidate meets the given requirements.",

  "quality.veryWeak": "Very weak",
  "quality.weak": "Weak",
  "quality.medium": "Medium",
  "quality.good": "Good",
  "quality.strong": "Strong",
  "quality.veryStrong": "Very strong",

  "entropy.title": "What does entropy mean?",
  "entropy.infoAria": "Explanation of entropy",
  "entropy.intro": "Entropy estimates how many bits of randomness the generation process contains. The larger the value, the more possible passphrases an attacker would have to search through.",
  "entropy.value": "{bits} bits ≈ 2{sup} possible outputs.",
  "entropy.count": "≈ {count} possible outputs",
  "entropy.notLength": "Entropy is not the same as character count. A longer passphrase is not automatically stronger; what matters is how large and how random the space it was drawn from is.",
  "entropy.moreWords": "Adding one more random word usually gives a much larger security increase than a predictable formatting rule.",
  "entropy.noCrackTime": "Cracking time depends heavily on how a given service stores and protects the password, so we do not give a misleading time estimate here.",
  "entropy.caveat": "Limiting the maximum length can reduce the effective search space; the estimate shown here does not necessarily account for that.",
  "entropy.disclaimer": "The Very weak – Very strong rating is informational, intended to make the estimated generation entropy easier to interpret; it is not an official standard classification.",

  "security.title": "🔒 Security & Privacy – 100% Local Generation",
  "security.localGeneration": "<strong>Passwords and passphrases are generated in your own browser.</strong> Generation happens entirely on your device, using your browser's built-in cryptographically secure random number generator. The generated password or passphrase is neither transmitted nor stored: not to a server, not in a cookie, not in localStorage and not in a log.",
  "security.noAnalytics": "<strong>No analytics and no third party.</strong> This site uses no Google Analytics or other tracking code, loads no third-party script, stylesheet, font or image, and does not fingerprint visitors. With no tracking cookies, no cookie consent banner is needed either.",
  "security.cspTitle": "<strong>Your browser enforces a strict network rule (Content Security Policy).</strong> The site's JavaScript may only open a connection to its own origin, never to a third-party server:",
  "security.cspBody": "CSP is an additional, browser-enforced protection layer that significantly narrows the possible paths for data exfiltration. <code>connect-src 'self'</code> prevents the site's JavaScript from opening a direct network connection to a third-party origin.",
  "security.sourcePrefix": "The source code is publicly inspectable on ",
  "security.sourceLink": "GitHub",
  "security.sourceSuffix": ": this gives transparency, but does not by itself guarantee security.",
  "security.technicalDetails": "Technical details",
  "security.liRng": "Randomness: <code>window.crypto.getRandomValues()</code> with rejection sampling, so there is no modulo bias; <code>Math.random()</code> appears nowhere.",
  "security.liNoStore": "Generated values never go into a URL, a log, a cookie, localStorage or a network request.",
  "security.liPrivacy": "The only stored setting is the chosen UI language (<code>pwgen_language</code> in localStorage). This is not tracking: it contains no identifier and has nothing to do with generated values.",
  "security.liClipboard": "Copying to the clipboard uses only the browser's <code>navigator.clipboard</code> API, locally.",
  "security.liResources": "Loaded resources: <code>index.html</code>, <code>app.css</code>, <code>app.js</code>, <code>i18n.js</code>, <code>lang/hun.js</code>, <code>lang/ui/hu.js</code>, <code>lang/ui/en.js</code> – all from the same origin.",
  "security.liCspList": "CSP: <code>default-src 'none'</code>; <code>script-src 'self'</code>; <code>style-src 'self'</code>; <code>connect-src 'self'</code>; <code>img-src 'self' data:</code>; <code>font-src 'self'</code>; <code>object-src 'none'</code>; <code>base-uri 'none'</code>; <code>form-action 'none'</code>. It contains neither <code>'unsafe-inline'</code> nor <code>'unsafe-eval'</code>.",
  "security.liConnectSrc": "<code>connect-src 'self'</code> blocks JavaScript connections to a third-party origin, while connections to the same origin remain permitted.",
  "security.liNoRequests": "After its own same-origin static resources have loaded, the application currently makes no network requests at all.",
  "security.liDefenseInDepth": "CSP is defense-in-depth: it is not a mathematical guarantee against every possible exfiltration mechanism, nor against a compromised browser or extension.",
  "security.liMetaDelivery": "CSP is currently delivered as a <code>&lt;meta&gt;</code> tag, because GitHub Pages does not allow setting custom HTTP response headers. The policy therefore contains no <code>frame-ancestors</code> directive: clickjacking protection can be configured with an HTTP header, but would not take effect from a meta tag.",
  "security.liFileScheme": "The <code>file:</code> scheme is present in the script/style directives so that the page also works when opened from a local file (<code>file://</code>).",

  "validation.tooLong": "⚠ {current} characters, maximum {max}.",
  "validation.missingUppercase": "⚠ The required uppercase letter is missing.",
  "validation.missingDigit": "⚠ The required digit is missing.",
  "validation.missingSpecial": "⚠ The required special character is missing.",
  "validation.forbiddenSpace": "⚠ The passphrase contains a space.",
  "validation.lengthFailure": "⚠ With the current settings, no passphrase shorter than {max} characters could be generated.",

  "toast.copied": "Copied to clipboard",

  "error.invalidUpperBound": "Invalid upper bound.",
  "error.wordListLoadFailed": "The Hungarian word list could not be loaded. Check that the lang folder (hun.js) is available next to index.html.",

  "seo.aria": "About the generator",
  "seo.title": "Hungarian Password & Passphrase Generator",
  "seo.description": "Generate strong random passwords and Hungarian passphrases locally in your browser. Generated passwords and passphrases are never sent to a server."
};
