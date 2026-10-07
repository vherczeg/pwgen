  "use strict";
  const $ = s => document.querySelector(s);
  // Fordítási segédfüggvény (i18n.js definiálja). Ha a nyelvi motor valamiért nem
  // töltődött be, a kulcs jelenik meg a szöveg helyén – nem omlik össze az alkalmazás.
  const t = (key, vars) => (typeof window.t === "function" ? window.t(key, vars) : key);
  const AMBIGUOUS = new Set(["I","l","1","O","0"]);
  const BASE_LOWER = "abcdefghijklmnopqrstuvwxyz";
  const BASE_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const BASE_NUMBERS = "0123456789";
  let hungarianWords = []; let lastPasswordBits=null;

  function secureRandomInt(max) {
    if (!Number.isSafeInteger(max) || max <= 0) throw new RangeError(t("error.invalidUpperBound"));
    const range = 0x100000000, limit = range - (range % max), b = new Uint32Array(1);
    do crypto.getRandomValues(b); while (b[0] >= limit);
    return b[0] % max;
  }
  const pick = source => source[secureRandomInt(source.length)];
  function secureShuffle(a) { for (let i=a.length-1;i>0;i--) { const j=secureRandomInt(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
  function clampInteger(v,min,max) { const n=Number.parseInt(v,10); return Number.isFinite(n)?Math.min(max,Math.max(min,n)):min; }
  function filterAmbiguous(chars) { return $("#avoid-ambiguous").checked ? [...chars].filter(c=>!AMBIGUOUS.has(c)).join("") : chars; }
  function uniqueChars(chars) { return [...new Set([...chars])].join(""); }
  // Hatfokozatú, tájékoztató jellegű UX-besorolás (nem hivatalos szabvány).
  function qualityForBits(bits) {
    if(bits>=80) return {label:t("quality.veryStrong"),c:"very-strong"};
    if(bits>=65) return {label:t("quality.strong"),c:"strong"};
    if(bits>=55) return {label:t("quality.good"),c:"good"};
    if(bits>=45) return {label:t("quality.medium"),c:"medium"};
    if(bits>=35) return {label:t("quality.weak"),c:"weak"};
    return {label:t("quality.veryWeak"),c:"very-weak"};
  }
  function showQuality(bits,bitsEl,qEl) { const q=qualityForBits(bits); bitsEl.textContent=t("password.bits",{bits:Math.round(bits)}); qEl.textContent=q.label; qEl.className=`quality ${q.c}`; }

  function passwordGroups() {
    const lower=filterAmbiguous(BASE_LOWER), upper=filterAmbiguous(BASE_UPPER);
    const useNumbers=$("#use-numbers").checked, useSymbols=$("#use-symbols").checked;
    const numbers=useNumbers?filterAmbiguous(BASE_NUMBERS):"";
    const symbols=useSymbols?uniqueChars($("#symbol-set").value):"";
    return {lower,upper,numbers,symbols,useNumbers,useSymbols};
  }

  function generatePassword() {
    const length=Number($("#password-length").value), g=passwordGroups();
    if (!g.lower.length || !g.upper.length) return;
    if (g.useSymbols && !g.symbols.length) { $("#password-result").textContent=t("password.needSymbol"); lastPasswordBits=0; showQuality(0,$("#password-bits"),$("#password-quality")); return; }
    let minNumbers=g.useNumbers?clampInteger($("#min-numbers").value,1,20):0;
    let minSymbols=g.useSymbols?clampInteger($("#min-symbols").value,1,20):0;
    $("#min-numbers").value=minNumbers; $("#min-symbols").value=minSymbols;
    const mandatory=2+minNumbers+minSymbols;
    if (mandatory>length) { $("#password-result").textContent=t("password.minGreaterThanLength",{count:mandatory}); lastPasswordBits=0; showQuality(0,$("#password-bits"),$("#password-quality")); return; }
    const pool=g.lower+g.upper+g.numbers+g.symbols;
    const out=[pick(g.lower),pick(g.upper)];
    for(let i=0;i<minNumbers;i++) out.push(pick(g.numbers));
    for(let i=0;i<minSymbols;i++) out.push(pick(g.symbols));
    while(out.length<length) out.push(pick(pool));
    $("#password-result").textContent=secureShuffle(out).join("");
    // Konzervatív becslés: a véletlen shuffle plusz entrópiáját nem számoljuk hozzá.
    let bits=Math.log2(g.lower.length)+Math.log2(g.upper.length);
    if(minNumbers) bits+=minNumbers*Math.log2(g.numbers.length);
    if(minSymbols) bits+=minSymbols*Math.log2(g.symbols.length);
    bits+=(length-mandatory)*Math.log2(pool.length);
    lastPasswordBits=bits; showQuality(bits,$("#password-bits"),$("#password-quality"));
  }

  function log2Combination(n,k) { if(k<0||k>n)return -Infinity; k=Math.min(k,n-k); let r=0; for(let i=1;i<=k;i++) r+=Math.log2(n-k+i)-Math.log2(i); return r; }
  function randomDigitString(length) { let s=""; for(let i=0;i<length;i++) s+=String(secureRandomInt(10)); return s; }

  let phraseCandidates = [];
  let candidateRows = [];
  let activeCapitalMode = "none";

  // Az "Elválasztó karakterek" mező az egyetlen forrás; a gombok csak szerkesztik azt.
  // A mezőben a pontos "123" a véletlen számjegy elválasztó (RANDOM_DIGIT) egyetlen
  // reprezentációja. Minden más számjegy érvénytelen literálként, a nem számjegy
  // karakterek pedig literál elválasztók.
  const RANDOM_DIGIT_TOKEN="123";

  function parseSeparatorField() {
    let rest=$("#separator-chars").value, randomDigit=false;
    if(rest.includes(RANDOM_DIGIT_TOKEN)) {
      randomDigit=true;
      // Minden további előfordulás ugyanaz az EGY token, nem növeli a súlyozást.
      rest=rest.split(RANDOM_DIGIT_TOKEN).join("");
    }
    const literals=[...new Set([...rest].filter(ch=>!/[0-9]/.test(ch)))];
    return {literals,randomDigit};
  }

  // A választható elválasztók: a literál karakterek + opcionálisan a véletlen számjegy (null).
  // A "123" így pontosan EGY választásnak számít, nem tíznek és nem háromnak.
  function separatorOptions() {
    const {literals,randomDigit}=parseSeparatorField();
    if(randomDigit) literals.push(null);
    return literals;
  }

  function separatorOptionCount() {
    const {literals,randomDigit}=parseSeparatorField();
    return literals.length+(randomDigit?1:0);
  }

  function renderSeparator(option) {
    return option===null?String(secureRandomInt(10)):option;
  }

  // Unicode-tudatos hossz: minden látható karakter egynek számít (kódpontonként).
  function characterLength(text) { return [...text].length; }

  // Egy jelölt elválasztói (szóhatáronként egy), hogy a hossz kiszámítható és
  // a maximális hossz szerinti elvetés (rejection) értelmes legyen.
  function rollCandidateSeparators(candidate) {
    const options=separatorOptions();
    candidate.separators=Array.from({length:Math.max(0,candidate.words.length-1)},()=>options.length?renderSeparator(pick(options)):"");
  }

  // Kanonikus forma: a "123" token legfeljebb egyszer szerepel, minden más számjegy
  // (akár csonka töredék) eltűnik, a literálok sorrendje és a beszúrási pozíció marad.
  function normalizeSeparatorField() {
    const input=$("#separator-chars");
    const raw=input.value;
    let out="", tokenUsed=false;
    for(let i=0;i<raw.length;) {
      if(!tokenUsed && raw.startsWith(RANDOM_DIGIT_TOKEN,i)) {
        out+=RANDOM_DIGIT_TOKEN; tokenUsed=true; i+=RANDOM_DIGIT_TOKEN.length; continue;
      }
      const ch=raw[i++];
      if(/[0-9]/.test(ch)) continue;   // számjegy literál elválasztóként érvénytelen
      if(out.includes(ch)) continue;   // nincs duplikált literál
      out+=ch;
    }
    if(out===raw) return;
    const caretFromEnd=raw.length-(input.selectionStart ?? raw.length);
    input.value=out;
    const position=Math.max(0,out.length-caretFromEnd);
    if(input.setSelectionRange) input.setSelectionRange(position,position);
  }

  function syncSeparatorButtons() {
    const {literals,randomDigit}=parseSeparatorField();
    document.querySelectorAll(".sep-btn").forEach(button=>{
      // A "123" gombnak nincs data-sep attribútuma: állapota a mezőben lévő pontos token.
      const active=button.dataset.sep===undefined ? randomDigit : literals.includes(button.dataset.sep);
      button.classList.toggle("active",active);
      button.setAttribute("aria-pressed",active?"true":"false");
    });
  }

  function toggleSeparatorChar(char) {
    const input=$("#separator-chars");
    const chars=[...input.value], index=chars.indexOf(char);
    if(index===-1) input.value+=char;
    else { chars.splice(index,1); input.value=chars.join(""); }
    if(input.setSelectionRange) input.setSelectionRange(input.value.length,input.value.length);
    syncSeparatorButtons();
    rerollSeparatorsAndRender();
  }

  // A "123" gomb a mezőbe írja, illetve onnan törli a pontos tokent (nincs külön állapot).
  function toggleRandomDigitSeparator() {
    const input=$("#separator-chars");
    if(parseSeparatorField().randomDigit) input.value=input.value.split(RANDOM_DIGIT_TOKEN).join("");
    else input.value+=RANDOM_DIGIT_TOKEN;
    normalizeSeparatorField();
    if(input.setSelectionRange) input.setSelectionRange(input.value.length,input.value.length);
    syncSeparatorButtons();
    rerollSeparatorsAndRender();
  }

  // Egy jelölt szókészlete (a "Szavak száma" csúszka maximumáig), hogy a szavak
  // számának módosítása ne sorsolja újra a már megjelenített szavakat.
  function buildCandidateWordPool() {
    const maxWords=Number($("#word-count").max) || 10;
    return Array.from({length:maxWords},()=>pick(hungarianWords));
  }

  // "Garantált számok" előbeállítások: a meglévő számblokk-mezőket vezérlik.
  const NUMBER_PRESETS={none:{blocks:0,min:1,max:1},one:{blocks:1,min:1,max:1},two:{blocks:2,min:1,max:1}};

  function numberPreset() {
    const checked=document.querySelector('input[name="number-preset"]:checked');
    return checked ? checked.value : "none";
  }

  function syncNumberPresetRow() {
    $("#custom-number-settings").hidden=numberPreset()!=="custom";
  }

  // Előbeállítás váltása: a szavak/szókészletek megmaradnak, csak a garantált számok újulnak.
  function applyNumberPreset(value) {
    const preset=NUMBER_PRESETS[value];
    if(preset) {
      $("#number-block-count").value=String(preset.blocks);
      $("#number-min-digits").value=String(preset.min);
      $("#number-max-digits").value=String(preset.max);
    }
    syncNumberPresetRow();
    syncPhraseNumberBlocks();
    rebuildCandidates();
  }

  // A szerkezeti beállítások egyszer, minden jelöltre közösen (és a mezők visszaklamppolása).
  function phraseSettings() {
    const count=Number($("#word-count").value);
    const blocks=clampInteger($("#number-block-count").value,0,count);
    const minD=clampInteger($("#number-min-digits").value,1,12);
    const maxD=clampInteger($("#number-max-digits").value,minD,12);

    $("#number-block-count").max=String(count);
    $("#number-block-count").value=String(blocks);
    $("#number-min-digits").value=String(minD);
    $("#number-max-digits").value=String(maxD);

    return {count,blocks,minD,maxD};
  }

  // ---- Weboldal követelményei: ELLENŐRZÉS, nem generátor-beállítás ----
  const MAX_LENGTH_MIN=8, MAX_LENGTH_MAX=128, MAX_LENGTH_ATTEMPTS=200;
  let generationLengthFailure=null;

  function maxLengthPreset() {
    const checked=document.querySelector('input[name="max-length"]:checked');
    return checked ? checked.value : "none";
  }

  function activeMaxLength() {
    const preset=maxLengthPreset();
    if(preset==="none") return null;
    if(preset==="custom") {
      const input=$("#max-length-custom");
      const value=clampInteger(input.value,MAX_LENGTH_MIN,MAX_LENGTH_MAX);
      input.value=String(value);
      return value;
    }
    return Number(preset);
  }

  function syncMaxLengthRow() {
    $("#max-length-custom-row").hidden=maxLengthPreset()!=="custom";
  }

  function websiteRequirements() {
    return {
      max: activeMaxLength(),
      upper: $("#require-upper").checked,
      digit: $("#require-digit").checked,
      special: $("#require-special").checked,
      noSpace: $("#forbid-space").checked
    };
  }

  function websiteRequirementsActive(req) {
    const r=req ?? websiteRequirements();
    return r.max!==null || r.upper || r.digit || r.special || r.noSpace;
  }

  // Speciális karakter: nem betű, nem számjegy, nem whitespace. A szóköz NEM az.
  function hasSpecialCharacter(text) { return [...text].some(ch=>!/[\p{L}\p{N}\s]/u.test(ch)); }

  // A TÉNYLEGES generált szöveget ellenőrzi (nem a beállításokat, nem a lehetőségeket).
  function checkWebsiteRequirements(text,req) {
    const r=req ?? websiteRequirements();
    const reasons=[];
    if(r.max!==null && characterLength(text)>r.max) reasons.push(t("validation.tooLong",{current:characterLength(text),max:r.max}));
    if(r.upper && !/\p{Lu}/u.test(text)) reasons.push(t("validation.missingUppercase"));
    if(r.digit && !/[0-9]/.test(text)) reasons.push(t("validation.missingDigit"));
    if(r.special && !hasSpecialCharacter(text)) reasons.push(t("validation.missingSpecial"));
    if(r.noSpace && /\s/.test(text)) reasons.push(t("validation.forbiddenSpace"));
    return {ok:reasons.length===0,reasons};
  }

  // A tényleges, másolható szöveg: szavak + számblokkok + elválasztók + nagybetűzés.
  function candidatePhrase(candidate) {
    const mode=capitalMode();
    const parts=candidate.words.map(({word,digits,side},index)=>{
      const text=caseWord(word,index,mode,candidate.capTarget);
      return side==="before"?digits+text:text+digits;
    });
    let phrase=parts[0] ?? "";
    for(let i=1;i<parts.length;i++) phrase+=(candidate.separators[i-1] ?? "")+parts[i];
    return phrase;
  }

  // Új jelölt a maximális hossz betartásával: a TELJES jelöltet (szavak, számok,
  // elválasztók, nagybetűzés) előállítjuk, és ha hosszabb a maximumnál, elvetjük.
  // Semmit nem csonkítunk és nem rövidítünk; ha a határ nem érhető el, a legutolsó
  // (túl hosszú) jelölt marad, és a kompatibilitás-ellenőrzés jelzi a túllépést.
  function buildCandidateWithMaxLength(settings,nextPool,capTarget) {
    const max=activeMaxLength();
    let candidate=null;
    for(let attempt=0;attempt<MAX_LENGTH_ATTEMPTS;attempt++) {
      candidate=buildCandidateParts(settings,nextPool(),capTarget);
      rollCandidateSeparators(candidate);
      if(max===null || characterLength(candidatePhrase(candidate))<=max) return candidate;
    }
    generationLengthFailure=max;
    return candidate;
  }

  function updateLengthWarning() {
    const element=$("#length-warning");
    element.hidden=generationLengthFailure===null;
    if(generationLengthFailure!==null) {
      element.textContent=t("validation.lengthFailure",{max:generationLengthFailure});
    }
  }

  // Kompakt visszajelzés a weboldal-követelményekről (a látható jelöltek egyedi hiányosságai).
  function updateWebsiteFeedback() {
    const element=$("#website-feedback");
    const req=websiteRequirements();
    if(!websiteRequirementsActive(req)) { element.hidden=true; element.textContent=""; return; }
    const reasons=[];
    phraseCandidates.forEach(candidate=>{
      checkWebsiteRequirements(candidatePhrase(candidate),req).reasons.forEach(reason=>{
        if(!reasons.includes(reason)) reasons.push(reason);
      });
    });
    element.hidden=false;
    element.textContent=reasons.length?reasons.join("\n"):t("compat.allOk");
  }

  // A harmonikák összecsukott összefoglalói (csak megjelenítés, nem generál semmit).
  const CAPITAL_MODE_KEYS={none:"capital.none",all:"capital.all",one:"capital.one",oneUpper:"capital.oneUpper"}; const capitalModeLabel=mode=>t(CAPITAL_MODE_KEYS[mode] ?? "capital.none");
  const NUMBER_PRESET_KEYS={none:"numbers.none",one:"numbers.one",two:"numbers.two"}; const numberPresetLabel=preset=>t(NUMBER_PRESET_KEYS[preset] ?? "numbers.none");

  function updateSettingSummaries() {
    const preset=numberPreset();
    if(preset==="custom") {
      const blocks=clampInteger($("#number-block-count").value,0,10);
      const minD=clampInteger($("#number-min-digits").value,1,12);
      const maxD=clampInteger($("#number-max-digits").value,minD,12);
      $("#summary-numbers").textContent=blocks===0
        ?t("summary.customNoBlock")
        :t("summary.customBlocks",{blocks,digits:minD===maxD?minD:minD+"–"+maxD});
    } else {
      $("#summary-numbers").textContent=numberPresetLabel(preset);
    }

    $("#summary-capital").textContent=capitalModeLabel(capitalMode());

    const parts=[];
    const max=activeMaxLength();
    if(max!==null) parts.push(t("summary.max",{max}));
    if($("#require-upper").checked) parts.push(t("summary.upper"));
    if($("#require-digit").checked) parts.push(t("summary.digit"));
    if($("#require-special").checked) parts.push(t("summary.special"));
    if($("#forbid-space").checked) parts.push(t("summary.noSpace"));
    $("#summary-website").textContent=parts.length?parts.join(" · "):t("summary.none");
  }

  // A státusz-oszlop: entrópia · hossz / minőség / weboldal-kompatibilitás.
  function updateCandidateStatus(index,phrase) {
    const candidate=phraseCandidates[index], row=candidateRows[index];
    const bits=candidateBits(candidate);
    const quality=qualityForBits(bits);
    const check=checkWebsiteRequirements(phrase);
    row.bits.textContent=t("candidate.status",{bits:Math.round(bits),length:characterLength(phrase)});
    row.quality.textContent=quality.label;
    row.quality.className=`quality ${quality.c}`;
    row.compat.hidden=!websiteRequirementsActive();
    row.compat.textContent=check.ok?t("compat.ok"):t("compat.bad");
    row.compat.className=`compat ${check.ok?"ok":"bad"}`;
  }

  // ---- Entrópia-magyarázat (ⓘ) ----
  const SUPERSCRIPT_DIGITS={"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹"};
  let entropyInfoIndex=null;

  function superscriptNumber(value) {
    return [...String(value)].map(ch=>SUPERSCRIPT_DIGITS[ch] ?? ch).join("");
  }

  // 2^bits pontos értéke BigInt-tel; túl hosszú értéknél null (akkor csak 2^N látszik).
  function decimalPossibilities(bits,maxDigits=50) {
    if(!Number.isInteger(bits) || bits<0 || bits>512) return null;
    const text=(2n**BigInt(bits)).toString();
    if(text.length>maxDigits) return null;
    return text.replace(/\B(?=(\d{3})+$)/g," ");
  }

  function fillEntropyInfo(candidate) {
    const bits=Math.round(candidateBits(candidate));
    $("#entropy-info-value").textContent=t("entropy.value",{bits,sup:superscriptNumber(bits)});
    const decimal=decimalPossibilities(bits);
    const countLine=$("#entropy-info-count");
    countLine.hidden=decimal===null;
    countLine.textContent=decimal===null?"":t("entropy.count",{count:decimal});
    // A hosszkorlát szűkíti az elfogadott kimenetek halmazát; a becslés ezt nem tartalmazza.
    $("#entropy-info-caveat").hidden=activeMaxLength()===null;
  }

  function openEntropyInfo(index) {
    const candidate=phraseCandidates[index];
    if(!candidate || !candidateRows[index]) return;
    if(entropyInfoIndex!==null && candidateRows[entropyInfoIndex]) candidateRows[entropyInfoIndex].info.setAttribute("aria-expanded","false");
    entropyInfoIndex=index;
    fillEntropyInfo(candidate);
    $("#entropy-info").hidden=false;
    candidateRows[index].info.setAttribute("aria-expanded","true");
    const close=$("#entropy-info-close");
    if(close && close.focus) close.focus();
  }

  function closeEntropyInfo(restoreFocus) {
    if(entropyInfoIndex===null) return;
    const row=candidateRows[entropyInfoIndex];
    if(row) {
      row.info.setAttribute("aria-expanded","false");
      if(restoreFocus && row.info.focus) row.info.focus();
    }
    entropyInfoIndex=null;
    $("#entropy-info").hidden=true;
  }

  function toggleEntropyInfo(index) {
    if(entropyInfoIndex===index) closeEntropyInfo(true);
    else openEntropyInfo(index);
  }

  // A nyitott magyarázat frissítése (újragenerálás vagy beállításváltozás után).
  function refreshEntropyInfo() {
    if(entropyInfoIndex===null) return;
    const candidate=phraseCandidates[entropyInfoIndex];
    if(!candidate) { closeEntropyInfo(false); return; }
    fillEntropyInfo(candidate);
  }

  // Elválasztó-beállítás változott: új elválasztók sorsolása, majd újrarajzolás
  // (a szavak, a garantált számok és a nagybetű-cél változatlanok maradnak).
  function rerollSeparatorsAndRender() {
    phraseCandidates.forEach(rollCandidateSeparators);
    renderCandidates();
  }

  // Nagybetűzés: a mód a vezérlőből jön, a véletlen cél a jelölt állapotában tárolódik.
  function capitalMode() {
    const checked=document.querySelector('input[name="capital-mode"]:checked');
    return checked ? checked.value : "none";
  }

  function isRandomCapitalMode(mode) { return mode==="one" || mode==="oneUpper"; }

  function capitalizeFirstLetter(word) { return word.charAt(0).toLocaleUpperCase("hu-HU")+word.slice(1); }

  function caseWord(word,wordIndex,mode,target) {
    if(mode==="all") return capitalizeFirstLetter(word);
    if(mode==="one") return wordIndex===target?capitalizeFirstLetter(word):word;
    if(mode==="oneUpper") return wordIndex===target?word.toLocaleUpperCase("hu-HU"):word;
    return word;
  }

  // Új véletlen cél minden látható jelöltnek (belépés egy véletlen módba).
  function rerollCapitalTargets() {
    phraseCandidates.forEach(candidate=>{ candidate.capTarget=secureRandomInt(candidate.words.length); });
  }

  // Egy jelölt új véletlen tartalma: szavak + számblokkok (érték és pozíció).
  function buildCandidateParts(settings,pool,capTarget) {
    const words=pool.slice(0,settings.count).map(word=>({word,digits:"",side:"after"}));
    const selectedWordIndexes=secureShuffle(Array.from({length:settings.count},(_,i)=>i)).slice(0,settings.blocks);
    for(const wordIndex of selectedWordIndexes) {
      words[wordIndex].digits=randomDigitString(settings.minD+secureRandomInt(settings.maxD-settings.minD+1));
      words[wordIndex].side=secureRandomInt(2)===0?"before":"after";
    }

    let baseBits=settings.count*Math.log2(hungarianWords.length);
    if(settings.blocks>0) {
      const lengths=settings.maxD-settings.minD+1, avg=(settings.minD+settings.maxD)/2;
      baseBits+=log2Combination(settings.count,settings.blocks)+settings.blocks*(1+Math.log2(lengths)+avg*Math.log2(10));
    }

    // A véletlen nagybetű-cél megőrzése, amíg érvényes (pl. ha csak a számblokkok változnak).
    const target=(Number.isInteger(capTarget) && capTarget>=0 && capTarget<settings.count)
      ? capTarget
      : secureRandomInt(settings.count);

    return {pool,words,baseBits,capTarget:target};
  }

  function candidateTarget() { return clampInteger($("#candidate-count").value,1,5); }

  // A csúszka állítása: a meglévő jelölteket megtartja, csak a hiányzókat pótolja
  // (vagy levágja), és kizárólag az új jelölteket rajzolja ki.
  function syncCandidateCount() {
    if(!hungarianWords.length) return;
    const settings=phraseSettings();
    const target=candidateTarget();

    if(target<phraseCandidates.length) {
      phraseCandidates.length=target;
      ensureCandidateRows(target);
      updateWebsiteFeedback();
      refreshEntropyInfo();
      hidePhraseMessage();
      return;
    }

    generationLengthFailure=null;
    while(phraseCandidates.length<target) {
      phraseCandidates.push(buildCandidateWithMaxLength(settings,()=>buildCandidateWordPool()));
      ensureCandidateRows(phraseCandidates.length);
      renderCandidate(phraseCandidates.length-1);
    }
    updateLengthWarning();
    hidePhraseMessage();
  }

  // Új tartalom minden jelöltnek; a meglévő szókészlet megmarad (szószám/blokk változásnál),
  // teljes újragenerálásnál viszont mindenki új szókészletet kap.
  function rebuildCandidates() {
    if(!hungarianWords.length) return;
    const settings=phraseSettings();
    const next=[];
    generationLengthFailure=null;
    for(let i=0;i<candidateTarget();i++) {
      const previous=phraseCandidates[i];
      next.push(buildCandidateWithMaxLength(settings,()=>previous?previous.pool:buildCandidateWordPool(),previous?previous.capTarget:undefined));
    }
    phraseCandidates=next;
    updateLengthWarning();
    renderCandidates();
  }

  // A sorok száma kövesse a jelöltekét: a meglévő sorokat nem építi újra.
  function ensureCandidateRows(count) {
    while(candidateRows.length<count) {
      const row=document.createElement("div"); row.className="phrase-row";
      const text=document.createElement("div"); text.className="result";
      const strength=document.createElement("div"); strength.className="phrase-strength";
      const bitsLine=document.createElement("span"); bitsLine.className="bits-line";
      const bits=document.createElement("span"); bits.className="bits";
      const info=document.createElement("button");
      info.type="button"; info.className="info-btn"; info.textContent="ⓘ";
      info.setAttribute("aria-label",t("entropy.infoAria"));
      info.setAttribute("aria-expanded","false");
      bitsLine.appendChild(bits); bitsLine.appendChild(info);
      const quality=document.createElement("span"); quality.className="quality";
      const compat=document.createElement("span"); compat.className="compat"; compat.hidden=true;
      strength.appendChild(bitsLine); strength.appendChild(quality); strength.appendChild(compat);
      const button=document.createElement("button"); button.type="button"; button.className="copy"; button.textContent=t("actions.copy");
      button.addEventListener("click",()=>copyText(text.textContent));
      const index=candidateRows.length;
      info.addEventListener("click",event=>{ if(event&&event.stopPropagation) event.stopPropagation(); toggleEntropyInfo(index); });
      row.appendChild(text); row.appendChild(strength); row.appendChild(button);
      $("#phrase-list").appendChild(row);
      candidateRows.push({row,text,bits,bitsLine,info,quality,compat,button});
    }
    while(candidateRows.length>count) candidateRows.pop().row.remove();
  }

  // Egy jelölt kirajzolása: a TÁROLT szavak/számblokkok/elválasztók + aktuális nagybetűzés.
  function renderCandidate(index) {
    const candidate=phraseCandidates[index];
    if(!candidate || !candidateRows[index]) return;

    const phrase=candidatePhrase(candidate);
    candidateRows[index].text.textContent=phrase;
    updateCandidateStatus(index,phrase);
  }

  // Egy jelölt entrópiája: ugyanaz a képlet, jelöltenként kiértékelve.
  // A "123" pontosan egy választásnak számít (log2 N); a hozzá tartozó számjegy
  // (log2 10) szándékosan nincs beszámítva: így a becslés továbbra is konzervatív.
  // FIGYELEM: a maximális hossz szerinti elvetés (rejection) szűkíti az elfogadott
  // kimenetek halmazát, ezt a becslés NEM tartalmazza. A feltételes entrópiához az
  // elfogadási valószínűség ismerete kellene, ezért a mutatott érték a feltétel
  // nélküli becslés (felső korlát), nem a hossz-korlátozott eloszlás entrópiája.
  function candidateBits(candidate) {
    const options=separatorOptionCount();
    let bits=candidate.baseBits;
    if(options>1) bits+=(candidate.words.length-1)*Math.log2(options);
    return bits;
  }

  function hidePhraseMessage() { $("#phrase-message").hidden=true; }

  // Minden jelölt újrarajzolása (elválasztó- vagy nagybetű-változás).
  function renderCandidates() {
    updateSettingSummaries();
    if(!phraseCandidates.length) return;
    ensureCandidateRows(phraseCandidates.length);
    phraseCandidates.forEach((_,index)=>renderCandidate(index));
    updateWebsiteFeedback();
    refreshEntropyInfo();
    hidePhraseMessage();
  }

  function generatePassphrase() {
    if(!hungarianWords.length) return;
    phraseCandidates=[];   // minden jelölt új szókészletet kap
    rebuildCandidates();
  }

  function switchTab(name) { const p=name==="password"; $("#password-tab").setAttribute("aria-selected",p); $("#phrase-tab").setAttribute("aria-selected",!p); $("#password-panel").hidden=!p; $("#phrase-panel").hidden=p; }
  let toastTimer;
  function showToast(msg){const toast=$("#toast");toast.textContent=msg;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove("show"),1500);}
  async function copyText(text){try{await navigator.clipboard.writeText(text);}catch{const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();}showToast(t("toast.copied"));}
  async function copyResult(id){await copyText(document.getElementById(id).textContent);}

  async function loadWordList(){
    try {
      const list=window.HU_WORDS;
      if(!list || !list.length) throw new Error("lang/hun.js did not load (window.HU_WORDS is missing).");
      hungarianWords=(Array.isArray(list)?list:String(list).split(/\r?\n/)).map(s=>String(s).trim()).filter(Boolean);
      if(hungarianWords.length!==16384) console.warn("Word list has "+hungarianWords.length+" entries, expected 16384.");
      $("#word-list-size").textContent=hungarianWords.length.toLocaleString(document.documentElement.lang || "hu-HU");
      $("#generate-phrase").disabled=false;
      generatePassphrase();
    } catch(err) {
      console.error(err);
      $("#phrase-message").textContent=t("error.wordListLoadFailed");
      $("#phrase-message").hidden=false;
    }
  }

  function syncPasswordMinimums() {
    const numbersEnabled = $("#use-numbers").checked;
    const symbolsEnabled = $("#use-symbols").checked;

    $("#min-numbers").disabled = !numbersEnabled;
    $("#min-symbols").disabled = !symbolsEnabled;

    if (numbersEnabled) {
      $("#min-numbers").min = "1";
      $("#min-numbers").value = String(clampInteger($("#min-numbers").value, 1, 20));
    } else {
      $("#min-numbers").value = "0";
    }

    if (symbolsEnabled) {
      $("#min-symbols").min = "1";
      $("#min-symbols").value = String(clampInteger($("#min-symbols").value, 1, 20));
    } else {
      $("#min-symbols").value = "0";
    }
  }

  function syncPhraseNumberBlocks(changedInput=null) {
    const wordCount=Number($("#word-count").value);
    const blockInput=$("#number-block-count");
    const minInput=$("#number-min-digits");
    const maxInput=$("#number-max-digits");

    blockInput.max=String(wordCount);
    const blocks=clampInteger(blockInput.value,0,wordCount);
    blockInput.value=String(blocks);

    const enabled=blocks>0;
    minInput.disabled=!enabled;
    maxInput.disabled=!enabled;
    if(!enabled) return;

    let minimum=clampInteger(minInput.value,1,12);
    let maximum=clampInteger(maxInput.value,1,12);
    if(minimum>maximum){
      if(changedInput===minInput) maximum=minimum;
      else minimum=maximum;
    }
    minInput.value=String(minimum);
    maxInput.value=String(maximum);
  }

  $("#password-tab").addEventListener("click",()=>switchTab("password"));
  $("#phrase-tab").addEventListener("click",()=>switchTab("phrase"));
  $("#generate-password").addEventListener("click",generatePassword);
  $("#generate-phrase").addEventListener("click",generatePassphrase);
  $("#password-length").addEventListener("input",e=>{$("#password-length-value").value=e.target.value;});
  ["#use-numbers","#use-symbols"].forEach(id=>$(id).addEventListener("change",syncPasswordMinimums));
  $("#avoid-ambiguous").addEventListener("change",()=>{});
  ["#min-numbers","#min-symbols","#symbol-set"].forEach(id=>$(id).addEventListener("input",()=>{}));
  $("#candidate-count").addEventListener("input",e=>{
    $("#candidate-count-value").value=e.target.value;
    syncCandidateCount();
  });
  $("#word-count").addEventListener("input",e=>{
    $("#word-count-value").value=e.target.value;
    syncPhraseNumberBlocks();
    rebuildCandidates();
  });
  document.querySelectorAll(".sep-btn").forEach(button=>{
    // A "123" gombnak nincs data-sep attribútuma: az a véletlen számjegy elválasztót kapcsolja.
    if(button.dataset.sep===undefined) button.addEventListener("click",toggleRandomDigitSeparator);
    else button.addEventListener("click",()=>toggleSeparatorChar(button.dataset.sep));
  });
  document.querySelectorAll('input[name="number-preset"]').forEach(radio=>{
    radio.addEventListener("change",()=>applyNumberPreset(numberPreset()));
  });
  document.querySelectorAll('input[name="max-length"]').forEach(radio=>{
    radio.addEventListener("change",()=>{
      generationLengthFailure=null;   // a figyelmeztetés az utolsó generálásra vonatkozott
      syncMaxLengthRow();
      updateLengthWarning();
      renderCandidates();             // csak újraszámol: nem generál és nem csonkít
    });
  });
  $("#max-length-custom").addEventListener("input",()=>{
    generationLengthFailure=null;
    updateLengthWarning();
    renderCandidates();
  });
  ["#require-upper","#require-digit","#require-special","#forbid-space"].forEach(id=>{
    $(id).addEventListener("change",renderCandidates);   // csak újraszámol, nem generál
  });
  // Exkluzív harmonika: egyszerre csak EGY beállítás-szekció lehet nyitva (csak megjelenítés).
  const ACCORDION_SECTIONS=["#acc-numbers","#acc-capital","#acc-website"];
  ACCORDION_SECTIONS.forEach(selector=>{
    const section=$(selector);
    section.addEventListener("toggle",()=>{
      if(!section.open) return;
      ACCORDION_SECTIONS.forEach(other=>{
        const element=$(other);
        if(element!==section && element.open) element.open=false;
      });
    });
  });
  // Entrópia-magyarázat: a ⓘ gomb nyit/zár, külső kattintás és Escape zár.
  $("#entropy-info-close").addEventListener("click",()=>closeEntropyInfo(true));
  document.addEventListener("click",event=>{
    if(entropyInfoIndex===null) return;
    const panel=$("#entropy-info");
    if(panel.contains && event.target && panel.contains(event.target)) return;
    closeEntropyInfo(false);
  });
  document.addEventListener("keydown",event=>{ if(event.key==="Escape") closeEntropyInfo(true); });
  $("#separator-chars").addEventListener("input",()=>{
    normalizeSeparatorField();
    syncSeparatorButtons();
    rerollSeparatorsAndRender();
  });
  document.querySelectorAll('input[name="capital-mode"]').forEach(radio=>{
    radio.addEventListener("change",()=>{
      const mode=capitalMode();
      // Csak akkor sorsol új célokat, ha nem-véletlen módból lépünk véletlen módba.
      if(isRandomCapitalMode(mode) && !isRandomCapitalMode(activeCapitalMode)) rerollCapitalTargets();
      activeCapitalMode=mode;
      renderCandidates();
    });
  });
  ["#number-block-count","#number-min-digits","#number-max-digits"].forEach(id=>$(id).addEventListener("input",event=>{
    syncPhraseNumberBlocks(event.target);
    rebuildCandidates();
  }));
  document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",()=>copyResult(b.dataset.copy)));

  // Nyelvváltás: KIZÁRÓLAG a látható szövegek frissülnek. Nem generálunk új jelszót
  // vagy jelmondatot, nem sorsolunk új elválasztót, számblokkot vagy nagybetű-célt, és
  // a már megjelenített értékek karakter szerint változatlanok maradnak.
  function refreshPasswordStatus() {
    if(lastPasswordBits===null) return;
    showQuality(lastPasswordBits,$("#password-bits"),$("#password-quality"));
  }
  function refreshTextsOnLanguageChange() {
    candidateRows.forEach(row=>{
      row.button.textContent=t("actions.copy");
      row.info.setAttribute("aria-label",t("entropy.infoAria"));
    });
    renderCandidates();          // csak megjelenítés: a tárolt jelöltek újrarajzolása
    updateLengthWarning();
    refreshPasswordStatus();
    const message=$("#phrase-message");
    if(!hungarianWords.length && message && !message.hidden) message.textContent=t("error.wordListLoadFailed");
  }
  if(window.PWGEN_L10N) window.PWGEN_L10N.onLanguageChange(refreshTextsOnLanguageChange);

  activeCapitalMode=capitalMode();
  syncNumberPresetRow();
  syncMaxLengthRow();
  updateLengthWarning();
  updateSettingSummaries();
  syncPasswordMinimums();
  syncPhraseNumberBlocks();
  syncSeparatorButtons();
  switchTab("phrase");
  generatePassword();
  loadWordList();
