// i18n.js - minimal, dependency-free UI localization (no build step,
// no external service, no network request).
//
// Architecture:
//   lang/ui/<language-code>.js  - language dictionaries (window.PWGEN_I18N.<code>)
//   i18n.js                     - this engine: t(), declarative binding, language switcher
//   app.js                      - the generator logic, using only t("key") calls
//
// The UI language (hu, en, later de/fr/es...) and the passphrase dictionary language
// (hun, later eng/deu...) are two separate concepts: this file deals only with the UI
// texts and never touches the word list.
(function () {
  "use strict";

  const STORAGE_KEY = "pwgen_language";
  const FALLBACK_LANGUAGE = "en";
  const HTML_LANG = { hu: "hu-HU", en: "en" };
  const registry = window.PWGEN_I18N = window.PWGEN_I18N || {};
  const changeListeners = [];
  let current = FALLBACK_LANGUAGE;

  function supported(code) {
    return Object.prototype.hasOwnProperty.call(registry, code);
  }

  // "hu-HU" -> "hu"; an unsupported language -> null
  function normalize(code) {
    if (!code) return null;
    const value = String(code).toLowerCase();
    if (supported(value)) return value;
    const base = value.split("-")[0];
    return supported(base) ? base : null;
  }

  function storedLanguage() {
    try { return normalize(localStorage.getItem(STORAGE_KEY)); } catch (err) { return null; }
  }

  function saveLanguage(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch (err) { /* private mode: nothing is stored */ }
  }

  // Browser language: navigator.languages in order, then navigator.language.
  function browserLanguage() {
    const list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
    for (const item of list) {
      const match = normalize(item);
      if (match) return match;
    }
    return null;
  }

  // Placeholder substitution. No eval and no dynamic code execution.
  function interpolate(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match);
  }

  // The single translation entry point: t("key", {var}).
  // If a key is missing from the current language, the English version is used, and as a last
  // resort the key itself (a visible signal rather than a silent failure).
  function t(key, vars) {
    const dict = registry[current] || {};
    const fallback = registry[FALLBACK_LANGUAGE] || {};
    const raw = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key]
      : (Object.prototype.hasOwnProperty.call(fallback, key) ? fallback[key] : key);
    return interpolate(String(raw), vars);
  }

  // The dictionary of one specific language (for the language list: each language shows its own name).
  function valueOf(code, key) {
    const dict = registry[code] || {};
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
  }

  // Declarative binding. data-i18n-html is deliberately a separate attribute: only first-party
  // language files may supply inline markup (<strong>, <code>) through it, and those files are
  // themselves scripts, so they are in the same trust circle as app.js.
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(element => { element.textContent = t(element.dataset.i18n); });
    scope.querySelectorAll("[data-i18n-html]").forEach(element => { element.innerHTML = t(element.dataset.i18nHtml); });
    scope.querySelectorAll("[data-i18n-aria-label]").forEach(element => element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel)));
    scope.querySelectorAll("[data-i18n-title]").forEach(element => element.setAttribute("title", t(element.dataset.i18nTitle)));
    scope.querySelectorAll("[data-i18n-placeholder]").forEach(element => element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder)));
  }

  function languageCodes() {
    return Object.keys(registry).sort();
  }

  // The menu is built from the registered languages, so a new language needs only one new
  // lang/ui/<code>.js script tag - the HTML does not change.
  function renderLanguageMenu() {
    const menu = document.getElementById("lang-menu");
    if (!menu) return;
    menu.textContent = "";
    languageCodes().forEach(code => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lang-option";
      button.dataset.language = code;
      button.setAttribute("lang", code);
      button.setAttribute("aria-current", code === current ? "true" : "false");

      const flag = document.createElement("span");
      flag.className = "lang-flag";
      flag.setAttribute("aria-hidden", "true");
      flag.textContent = valueOf(code, "language.flag");
      button.appendChild(flag);

      const name = document.createElement("span");
      name.textContent = valueOf(code, "language.name");
      button.appendChild(name);

      button.addEventListener("click", () => {
        setLanguage(code, { persist: true });
        const switcher = document.getElementById("lang-switcher");
        if (switcher) {
          switcher.open = false;
          const summary = switcher.querySelector("summary");
          if (summary && summary.focus) summary.focus();
        }
      });

      item.appendChild(button);
      menu.appendChild(item);
    });
  }

  function updateSwitcher() {
    const code = document.getElementById("lang-current");
    if (code) code.textContent = valueOf(current, "language.code");
    const summary = document.querySelector("#lang-switcher > summary");
    if (summary) summary.setAttribute("aria-label", t("language.currentAria", { name: valueOf(current, "language.name") }));
  }

  function setLanguage(code, options) {
    const opts = options || {};
    current = normalize(code) || FALLBACK_LANGUAGE;
    if (opts.persist) saveLanguage(current);
    document.documentElement.lang = HTML_LANG[current] || current;
    document.title = t("app.documentTitle");
    apply(document);
    renderLanguageMenu();
    updateSwitcher();
    changeListeners.forEach(listener => {
      try { listener(current); } catch (err) { /* a view refresh error must not break the language switch */ }
    });
  }

  function onLanguageChange(listener) {
    changeListeners.push(listener);
  }

  // The language is always decided when the document loads, before app.js runs:
  // 1) saved choice, 2) browser language, 3) English.
  window.t = t;
  window.PWGEN_L10N = {
    t: t,
    apply: apply,
    setLanguage: setLanguage,
    onLanguageChange: onLanguageChange,
    valueOf: valueOf,
    languages: languageCodes,
    get language() { return current; }
  };
  setLanguage(storedLanguage() || browserLanguage() || FALLBACK_LANGUAGE);
})();
