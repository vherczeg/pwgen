// i18n.js – minimál, függőség nélküli felületi lokalizáció (nincs build lépés,
// nincs külső szolgáltatás, nincs hálózati kérés).
//
// Architektúra:
//   lang/ui/<nyelvkód>.js  – nyelvi szótárak (window.PWGEN_I18N.<kód>)
//   i18n.js                – ez a motor: t(), deklaratív kötés, nyelvválasztó
//   app.js                 – a generátor logikája, csak t("kulcs") hívásokkal
//
// A felületi nyelv (hu, en, később de/fr/es…) és a jelmondat-szótár nyelve
// (hun, később eng/deu…) két külön fogalom: ez a fájl kizárólag a felületi
// szövegekkel foglalkozik, a szólistát nem érinti.
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

  // "hu-HU" -> "hu"; ismeretlen nyelv -> null
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
    try { localStorage.setItem(STORAGE_KEY, code); } catch (err) { /* privát mód: nincs tárolás */ }
  }

  // Böngészőnyelv: navigator.languages sorrendben, majd navigator.language.
  function browserLanguage() {
    const list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
    for (const item of list) {
      const match = normalize(item);
      if (match) return match;
    }
    return null;
  }

  // {helyorzo} cseréje. Nincs eval és nincs dinamikus kódvégrehajtás.
  function interpolate(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match);
  }

  // Egyetlen fordítási belépési pont: t("kulcs", {valtozo}).
  // Ha egy kulcs hiányzik az aktuális nyelvből, az angol változat, végső esetben
  // maga a kulcs jelenik meg (látható jelzés, nem néma hiba).
  function t(key, vars) {
    const dict = registry[current] || {};
    const fallback = registry[FALLBACK_LANGUAGE] || {};
    const raw = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key]
      : (Object.prototype.hasOwnProperty.call(fallback, key) ? fallback[key] : key);
    return interpolate(String(raw), vars);
  }

  // Egy adott nyelv saját szótára (a nyelvlistához: mindegyik nyelv a saját nevét mutatja).
  function valueOf(code, key) {
    const dict = registry[code] || {};
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
  }

  // Deklaratív kötés. A data-i18n-html szándékosan külön attribútum: csak első féltől
  // származó nyelvi fájlok adhatnak benne inline jelölést (<strong>, <code>), és ezek
  // a fájlok maguk is scriptek, tehát ugyanabban a bizalmi körben vannak, mint az app.js.
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

  // A menü a regisztrált nyelvekből épül fel, ezért egy új nyelvhez csak egy új
  // lang/ui/<kód>.js script tag kell – a HTML nem változik.
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
      try { listener(current); } catch (err) { /* egy nézetfrissítési hiba ne törje meg a nyelvváltást */ }
    });
  }

  function onLanguageChange(listener) {
    changeListeners.push(listener);
  }

  // A nyelv mindig a dokumentum betöltésekor dől el, mielőtt az app.js futna:
  // 1) mentett választás, 2) böngészőnyelv, 3) angol.
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
