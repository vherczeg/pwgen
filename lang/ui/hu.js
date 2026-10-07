// Magyar felületi szövegek (UI strings) – NEM a jelmondat-szólista.
// A szólista külön fájl: lang/hun.js (window.HU_WORDS).
// A kulcsok szemantikusak és nyelvfüggetlenek; a HTML a data-i18n attribútumokon
// keresztül, a JavaScript a t("kulcs", {valtozo}) híváson keresztül olvassa őket.
// Az értékek tartalmazhatnak {helyorzo} interpolációt; néhány szöveg szándékosan
// tartalmaz inline HTML-t (<strong>, <code>) – ezekhez a HTML-ben data-i18n-html tartozik.
window.PWGEN_I18N = window.PWGEN_I18N || {};

window.PWGEN_I18N.hu = {
  // A nyelv saját neve (endonima) – a többi nyelv listájában ez jelenik meg.
  "language.name": "Magyar",
  "language.code": "HU",
  "language.flag": "🇭🇺",
  "language.selectAria": "Nyelv kiválasztása",
  "language.menuAria": "Elérhető nyelvek",
  "language.currentAria": "Aktuális nyelv: {name}",

  "app.title": "Jelmondat és Jelszó Generátor",
  "app.subtitle": "Minden véletlen választás helyben, a böngésző biztonságos véletlenszám-generátorával történik.",
  "app.documentTitle": "Magyar jelszó- és jelmondat-generátor | Biztonságos password & passphrase generator",
  "app.sourceLink": "Forráskód",
  "app.sourceLinkAria": "Forráskód a GitHubon (új lapon nyílik meg)",

  "tabs.groupAria": "Generátor típusa",
  "tabs.passphrase": "Jelmondat",
  "tabs.password": "Jelszó",

  "actions.copy": "Másolás",
  "actions.newPassword": "Új jelszó",
  "actions.newPassphrase": "Új jelmondat",
  "actions.close": "Bezárás",

  "password.lengthLabel": "Jelszó hossza",
  "password.options": "Beállítások",
  "password.numbers": "Számjegyek (0–9)",
  "password.symbols": "Speciális jelek",
  "password.avoidAmbiguous": "Hasonló karakterek kerülése",
  "password.optionsHelp": "A kis- és nagybetűk mindig szerepelnek a jelszóban. A hasonló karakterek kerülése kizárja az I, l, 1, O és 0 karaktereket.",
  "password.advanced": "Speciális beállítások",
  "password.minNumbers": "Minimum számjegy",
  "password.minSymbols": "Minimum speciális jel",
  "password.symbolSet": "Használható speciális karakterek",
  "password.symbolSetHelp": "Ha egy webhely nem fogad el bizonyos jeleket, egyszerűen töröld őket innen. A minimum értékek csak akkor érvényesek, ha az adott karaktertípus be van kapcsolva.",
  "password.bits": "Becsült entrópia: {bits} bit",
  "password.needSymbol": "Adj meg legalább egy speciális karaktert!",
  "password.minGreaterThanLength": "A minimum karakterek száma ({count}) nagyobb a jelszó hosszánál.",

  "passphrase.messageLoading": "Szólista betöltése…",
  "passphrase.candidateCount": "Jelmondatok száma",
  "passphrase.wordCount": "Szavak száma",
  "passphrase.separatorCharacters": "Elválasztó karakterek:",

  "separator.groupAria": "Gyakori elválasztó karakterek",
  "separator.space": "Szóköz",
  "separator.randomDigitAria": "Véletlenszerű számjegy elválasztóként",
  "separator.help": "A mező karakterei közül minden szóhatáron külön, véletlenszerűen választ. Üres mező esetén nincs elválasztó. A „123” a véletlen számjegy elválasztó; önálló számjegy nem használható.",

  "settings.guaranteedNumbers": "Garantált számok",
  "settings.capitalization": "Nagybetűzés",
  "settings.websiteRequirements": "Weboldal követelményei",

  "numbers.none": "Nincs",
  "numbers.one": "1 szám",
  "numbers.two": "2 szám",
  "numbers.custom": "Egyéni…",
  "numbers.help": "A kiválasztott számok biztosan bekerülnek a jelmondatba. Az elválasztóknál bekapcsolható 123 ettől függetlenül, véletlenszerűen használhat számjegyet elválasztóként.",
  "numbers.blocks": "Számblokkok száma",
  "numbers.minDigits": "Min. számjegy / blokk",
  "numbers.maxDigits": "Max. számjegy / blokk",
  "numbers.blocksHelp": "Legfeljebb egy blokk kerül egy szóhoz, a szó elejére vagy végére.",

  "capital.none": "Nincs",
  "capital.all": "Minden szó",
  "capital.one": "Egy véletlen szó",
  "capital.oneUpper": "Egy véletlen szó CSUPA NAGYBETŰ",

  "website.maxLength": "Maximális hossz",
  "website.none": "Nincs",
  "website.custom": "Egyéni…",
  "website.customMax": "Egyéni maximum",
  "website.maxHelp": "Ha egy új jelmondat hosszabb a maximumnál, a generátor a teljes jelmondatot elveti és újat sorsol. Meglévő jelmondatot soha nem vág le.",
  "website.requires": "Az oldal megköveteli:",
  "website.requiresUpper": "Nagybetű",
  "website.requiresDigit": "Szám",
  "website.requiresSpecial": "Speciális karakter",
  "website.forbids": "Az oldal tiltja:",
  "website.forbidsSpace": "Szóköz",

  "how.title": "ⓘ Hogyan működik?",
  "how.lead": "Magyar szólista:",
  "how.bodyPrefix": "a generátor",
  "how.bodySuffix": "gyakoriság alapján kiválasztott, egyedi szót használ. A választás minden alkalommal helyben, kriptográfiailag biztonságos véletlennel történik.",

  "summary.none": "Nincs",
  "summary.customNoBlock": "Egyéni · nincs blokk",
  "summary.customBlocks": "Egyéni · {blocks} blokk · {digits} számjegy",
  "summary.max": "Max. {max}",
  "summary.upper": "Nagybetű",
  "summary.digit": "Szám",
  "summary.special": "Speciális",
  "summary.noSpace": "Nincs szóköz",

  "candidate.status": "{bits} bit · {length} karakter",
  "compat.ok": "✓ Megfelel",
  "compat.bad": "⚠ Nem felel meg",
  "compat.allOk": "✓ Minden jelölt megfelel a megadott követelményeknek.",

  "quality.veryWeak": "Nagyon gyenge",
  "quality.weak": "Gyenge",
  "quality.medium": "Közepes",
  "quality.good": "Jó",
  "quality.strong": "Erős",
  "quality.veryStrong": "Nagyon erős",

  "entropy.title": "Mit jelent az entrópia?",
  "entropy.infoAria": "Entrópia magyarázata",
  "entropy.intro": "Az entrópia azt becsüli, hány bitnyi véletlenszerűség van a generálási folyamatban. Minél nagyobb az érték, annál több lehetséges jelmondat közül kellene egy támadónak keresnie.",
  "entropy.value": "{bits} bit ≈ 2{sup} lehetséges kimenet.",
  "entropy.count": "≈ {count} lehetséges kimenet",
  "entropy.notLength": "Az entrópia nem ugyanaz, mint a karakterszám. Egy hosszabb jelmondat nem automatikusan erősebb; az számít, hogy mekkora és mennyire véletlen generálási térből választottuk.",
  "entropy.moreWords": "Általában egy újabb véletlen szó hozzáadása sokkal nagyobb biztonsági növekedést ad, mint egy kiszámítható formázási szabály.",
  "entropy.noCrackTime": "A feltörési idő erősen függ attól, hogyan tárolja és védi a jelszót az adott szolgáltatás, ezért itt nem adunk félrevezető időbecslést.",
  "entropy.caveat": "A maximális hossz korlátozása csökkentheti a tényleges keresési teret; a kijelzett becslés ezt jelenleg nem feltétlenül veszi figyelembe.",
  "entropy.disclaimer": "A Nagyon gyenge – Nagyon erős besorolás tájékoztató jellegű, a becsült generálási entrópia könnyebb értelmezésére szolgál; nem hivatalos szabványos besorolás.",

  "security.title": "🔒 Biztonság és adatvédelem – 100% helyi generálás",
  "security.localGeneration": "<strong>A jelszavak és a jelmondatok a te böngésződben készülnek.</strong> A generálás teljes egészében a készülékeden történik, a böngésző beépített, kriptográfiailag biztonságos véletlenszám-generátorával. A létrehozott jelszó vagy jelmondat nem kerül elküldésre és nem kerül tárolásra: sem szerverre, sem sütibe, sem localStorage-ba, sem naplóba.",
  "security.noAnalytics": "<strong>Nincs analitika és nincs harmadik fél.</strong> Az oldal nem használ Google Analyticset vagy más követőkódot, nem tölt be harmadik féltől származó scriptet, stíluslapot, fontot vagy képet, és nem készít ujjlenyomatot a látogatókról. Követő cookie hiányában cookie-hozzájárulási sávra sincs szükség.",
  "security.cspTitle": "<strong>A böngésződ szigorú hálózati szabályt kényszerít ki (Content Security Policy).</strong> Az oldal JavaScriptje csak a saját eredetére nyithat kapcsolatot, harmadik féltől származó szerverhez nem:",
  "security.cspBody": "A CSP egy plusz, böngésző által kikényszerített védelmi réteg, amely jelentősen szűkíti az adatszivárgás lehetséges útvonalait. A <code>connect-src 'self'</code> megakadályozza, hogy az oldal JavaScriptje közvetlen hálózati kapcsolatot nyisson harmadik fél eredetéhez.",
  "security.sourcePrefix": "A forráskód nyilvánosan ellenőrizhető a ",
  "security.sourceLink": "GitHubon",
  "security.sourceSuffix": ": ez átláthatóságot ad, de önmagában nem garantál biztonságot.",
  "security.technicalDetails": "Technikai részletek",
  "security.liRng": "Véletlenszám: <code>window.crypto.getRandomValues()</code> elutasításos mintavétellel (rejection sampling), így nincs modulo-eltolás; <code>Math.random()</code> sehol nem szerepel.",
  "security.liNoStore": "A generált értékek nem kerülnek URL-be, naplóba, sütibe, localStorage-ba és hálózati kérésbe.",
  "security.liPrivacy": "Az egyetlen tárolt beállítás a választott felületi nyelv (<code>pwgen_language</code> a localStorage-ban). Ez nem követés: nincs benne azonosító, és a generált értékekhez semmi köze.",
  "security.liClipboard": "Vágólapra másolás kizárólag a böngésző <code>navigator.clipboard</code> API-jával, helyben történik.",
  "security.liResources": "Betöltött erőforrások: <code>index.html</code>, <code>app.css</code>, <code>app.js</code>, <code>i18n.js</code>, <code>lang/hun.js</code>, <code>lang/ui/hu.js</code>, <code>lang/ui/en.js</code> – mindegyik ugyanarról az eredetről.",
  "security.liCspList": "CSP: <code>default-src 'none'</code>; <code>script-src 'self'</code>; <code>style-src 'self'</code>; <code>connect-src 'self'</code>; <code>img-src 'self' data:</code>; <code>font-src 'self'</code>; <code>object-src 'none'</code>; <code>base-uri 'none'</code>; <code>form-action 'none'</code>. Nincs benne <code>'unsafe-inline'</code> és <code>'unsafe-eval'</code>.",
  "security.liConnectSrc": "A <code>connect-src 'self'</code> a harmadik fél eredetére irányuló JavaScript-kapcsolatokat tiltja, az ugyanarra az eredetre irányuló kapcsolatokat viszont engedélyezi.",
  "security.liNoRequests": "Az alkalmazás a saját, azonos eredetű statikus erőforrásainak betöltése után jelenleg egyetlen hálózati kérést sem indít.",
  "security.liDefenseInDepth": "A CSP védelem-mélység (defense-in-depth), nem matematikai garancia minden lehetséges adatszivárgási mechanizmus, illetve a feltört böngésző vagy bővítmény ellen.",
  "security.liMetaDelivery": "A CSP jelenleg <code>&lt;meta&gt;</code> tagként érkezik, mert a GitHub Pages nem teszi lehetővé saját HTTP-válaszfejlécek beállítását. Ezért a CSP nem tartalmaz <code>frame-ancestors</code> direktívát: a kattintáslopás (clickjacking) elleni védelem HTTP-fejléccel állítható be, meta tagből viszont nem érvényesülne.",
  "security.liFileScheme": "A <code>file:</code> séma azért szerepel a script/style direktívákban, hogy az oldal helyi fájlból (<code>file://</code>) megnyitva is működjön.",

  "validation.tooLong": "⚠ {current} karakter, a maximum {max}.",
  "validation.missingUppercase": "⚠ Hiányzik a szükséges nagybetű.",
  "validation.missingDigit": "⚠ Hiányzik a szükséges szám.",
  "validation.missingSpecial": "⚠ Hiányzik a szükséges speciális karakter.",
  "validation.forbiddenSpace": "⚠ A jelmondat szóközt tartalmaz.",
  "validation.lengthFailure": "⚠ A jelenlegi beállításokkal nem sikerült {max} karakter alatti jelmondatot generálni.",

  "toast.copied": "Vágólapra másolva",

  "error.invalidUpperBound": "Érvénytelen felső határ.",
  "error.wordListLoadFailed": "A magyar szólista nem tölthető be. Ellenőrizd, hogy a lang mappa (hun.js) elérhető-e az index.html mellett.",

  "seo.aria": "A generátorról",
  "seo.title": "Magyar password és passphrase generator",
  "seo.description": "Az oldal erős random jelszavak és magyar jelmondatok (passphrase-ek) készítésére használható. A generálás helyben történik; a létrehozott jelszó nem kerül elküldésre szerverre."
};
