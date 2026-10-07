  "use strict";
  const $ = s => document.querySelector(s);
  // Translation helper (defined by i18n.js). If the language engine fails to load, the key
  // itself is shown in place of the text, so the application still works.
  const t = (key, vars) => (typeof window.t === "function" ? window.t(key, vars) : key);
  const AMBIGUOUS = new Set(["I","l","1","O","0"]);
  const BASE_LOWER = "abcdefghijklmnopqrstuvwxyz";
  const BASE_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const BASE_NUMBERS = "0123456789";
  let hungarianWords = []; let lastPasswordBits=null; let lastPasswordLength=0;

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
  // Six-level, informational UX rating (not an official standard). The scale itself is
  // shared by all three tabs (strength.js); for generated values it classifies the
  // generation entropy in bits.
  function qualityForBits(bits) {
    const level=window.PWGEN_STRENGTH.levelForBits(bits);
    return {label:t(window.PWGEN_STRENGTH.keyFor(level)),c:level};
  }
  function showQuality(bits,bitsEl,qEl) {
    const q=qualityForBits(bits);
    // Compact metadata line, same format as the passphrase candidate rows.
    bitsEl.textContent=t("candidate.status",{bits:Math.round(bits),length:lastPasswordLength});
    qEl.textContent=q.label;
    qEl.className=`quality ${q.c}`;
    window.PWGEN_STRENGTH.fillMeter($("#password-meter"),q.c);
  }

  function passwordGroups() {
    const lower=filterAmbiguous(BASE_LOWER), upper=filterAmbiguous(BASE_UPPER);
    const useNumbers=$("#use-numbers").checked, useSymbols=$("#use-symbols").checked;
    const numbers=useNumbers?filterAmbiguous(BASE_NUMBERS):"";
    const symbols=useSymbols?uniqueChars($("#symbol-set").value):"";
    return {lower,upper,numbers,symbols,useNumbers,useSymbols};
  }

  // ---- Uniform valid-output generation and its exact entropy ----
  //
  // A generated password is described by its class-count tuple (L,U,D,S): how many lowercase,
  // uppercase, digit and special characters it contains. Only the tuples allowed by the active
  // constraints are used, and such a tuple covers exactly
  //     multinomial(n;L,U,D,S) * l^L * u^U * d^D * s^S
  // different strings (choose the positions class by class, then a character per position).
  //
  // Every one of those counts is computed as an EXACT BigInt, the tuples add up to the exact
  // size of the valid-output space, and the tuple is drawn with an exactly uniform BigInt in
  // [0, total) - so the generation distribution is uniform over the valid space, with no
  // floating-point probability and no modulo bias anywhere in the draw (see secureRandomBigInt).
  // The entropy is log2 of that very same BigInt total, so the displayed value and the sampler
  // describe one and the same exact valid-output space:
  //     lastPasswordBits = log2BigInt(total) = log2(number of valid outputs).
  //
  // Minimums are floors by construction: no minimum is ever filled from a different class, so
  // every active constraint holds for every generated value - no rejection loop, no retries.
  // The maximums cap their class; whatever is left over goes to lowercase/uppercase, which
  // always appear at least once (L,U >= 1).

  const FACTORIAL_MAX=64;       // the password length selector is capped at 64
  const BIG_FACTORIAL=[1n];     // n! for n = 0..64, as exact BigInt
  for(let i=1;i<=FACTORIAL_MAX;i++) BIG_FACTORIAL[i]=BIG_FACTORIAL[i-1]*BigInt(i);

  // "No limit" is the empty option value in the UI; internally unlimited is null.
  function readMaxLimit(element) {
    if(!element) return null;
    if(element.value===""||element.value==null) return null;
    const value=Number.parseInt(element.value,10);
    if(!Number.isFinite(value)||value<1) return null;
    return Math.min(20,value);
  }

  // Every allowed class-count tuple for a password of `n` characters. The enabled state of the
  // digit and symbol classes comes from the explicit flags and is NEVER inferred from an
  // alphabet size: an enabled class with an empty alphabet must not be treated as disabled.
  function allowedClassCounts(n, sizes, flags) {
    const tuples=[];
    const digitLow=flags.numbersEnabled?Math.max(1,flags.minDigits):0;
    const digitHigh=flags.numbersEnabled?Math.min(flags.maxDigits??n-2,n-2):0;
    const symbolLow=flags.symbolsEnabled?Math.max(1,flags.minSymbols):0;
    const symbolHigh=flags.symbolsEnabled?Math.min(flags.maxSymbols??n-2,n-2):0;
    if(digitLow>digitHigh||symbolLow>symbolHigh) return tuples;
    for(let D=digitLow;D<=digitHigh;D++) {
      for(let S=symbolLow;S<=symbolHigh;S++) {
        const letters=n-D-S;               // L+U, with L,U >= 1 enforced below
        if(letters<2) continue;
        for(let L=1;L<=letters-1;L++) tuples.push({lower:L,upper:letters-L,digits:D,symbols:S});
      }
    }
    return tuples;
  }

  // Exact powers of one class alphabet size, computed once per size (a tuple needs one power
  // per class, and a BigInt "**" per tuple would dominate the cost at the maximum length).
  const POWER_TABLES=new Map();
  function powerTableFor(size) {
    let table=POWER_TABLES.get(size);
    if(!table) {
      table=[1n];
      const step=BigInt(size);
      for(let i=1;i<=FACTORIAL_MAX;i++) table[i]=table[i-1]*step;
      if(POWER_TABLES.size>=16) POWER_TABLES.clear();   // the alphabets are a handful of sizes
      POWER_TABLES.set(size,table);
    }
    return table;
  }

  // The exact number of distinct strings covered by one tuple: choose the positions class by
  // class (multinomial), then one character per position from each class alphabet.
  function tupleOutputCount(tuple, sizes) {
    const total=tuple.lower+tuple.upper+tuple.digits+tuple.symbols;
    let count=BIG_FACTORIAL[total]/(BIG_FACTORIAL[tuple.lower]*BIG_FACTORIAL[tuple.upper]
      *BIG_FACTORIAL[tuple.digits]*BIG_FACTORIAL[tuple.symbols]);
    if(tuple.lower) count*=powerTableFor(sizes.lower)[tuple.lower];
    if(tuple.upper) count*=powerTableFor(sizes.upper)[tuple.upper];
    if(tuple.digits) count*=powerTableFor(sizes.digits)[tuple.digits];
    if(tuple.symbols) count*=powerTableFor(sizes.symbols)[tuple.symbols];
    return count;
  }

  // The exact size of the valid-output space: the tuples are disjoint, so their exact counts
  // simply add up.
  function validOutputCount(tuples, sizes) {
    let total=0n;
    for(const tuple of tuples) total+=tupleOutputCount(tuple,sizes);
    return total;
  }

  // Exact log2 of a positive BigInt. The bit length gives the integer part and the leading 53
  // bits give the fraction, so the double result is accurate to well under 1e-15 bits - the
  // entropy is a numerically stable conversion of the exact BigInt count, not an approximation
  // of the distribution.
  function log2BigInt(value) {
    if(value<=0n) return 0;
    const bits=value.toString(2).length;          // 2^(bits-1) <= value < 2^bits
    if(bits<=53) return Math.log2(Number(value));
    const shift=BigInt(bits-53);
    return Number(shift)+Math.log2(Number(value>>shift));
  }

  // Entropy of the generation process: log2 of the very same exact total the sampler draws from.
  function passwordEntropyBits(tuples, sizes) { return log2BigInt(validOutputCount(tuples,sizes)); }

  // A uniform BigInt in [0, bound) from crypto.getRandomValues, by rejection sampling:
  // the raw draw is uniform over [0, 2^bits) (the surplus high bits of the first byte are
  // cleared, which keeps it uniform) and every value >= bound is rejected and redrawn whole.
  // Rejecting the entire draw - instead of reducing it modulo bound - is what makes the result
  // exactly uniform: each accepted value is reached by the same number of raw draws, and since
  // 2^(bits-1) <= bound the acceptance probability is always >= 1/2.
  // An empty range is a programming error, not a random draw: bound <= 0 throws instead of
  // silently returning a value that is not inside [0, bound).
  function secureRandomBigInt(bound) {
    if(bound<=0n) throw new RangeError("secureRandomBigInt: bound must be positive, got "+bound);
    if(bound===1n) return 0n;                          // exactly one possible value
    const bits=bound.toString(2).length;               // 2^(bits-1) <= bound < 2^bits
    const byteCount=Math.ceil(bits/8);
    const buffer=new Uint8Array(byteCount);
    const surplus=byteCount*8-bits;
    for(;;) {
      crypto.getRandomValues(buffer);
      if(surplus) buffer[0]&=0xff>>>surplus;
      let value=0n;
      for(let i=0;i<byteCount;i++) value=(value<<8n)|BigInt(buffer[i]);
      if(value<bound) return value;
    }
  }

  // Chooses a tuple with probability EXACTLY proportional to its exact output count.
  function sampleTupleFromWeights(tuples, weights, total) {
    if(tuples.length===1) return tuples[0];
    if(total<=0n) return tuples[secureRandomInt(tuples.length)];   // defensive, cannot happen
    const target=secureRandomBigInt(total);
    let cumulative=0n;
    for(let i=0;i<tuples.length;i++) {
      cumulative+=weights[i];
      if(target<cumulative) return tuples[i];
    }
    return tuples[tuples.length-1];   // unreachable: target < total === cumulative
  }

  // Convenience wrapper for callers that only have the tuples (recomputes the exact weights).
  function sampleClassCounts(tuples, sizes) {
    if(tuples.length===1) return tuples[0];
    const weights=tuples.map(tuple=>tupleOutputCount(tuple,sizes));
    let total=0n;
    for(const weight of weights) total+=weight;
    return sampleTupleFromWeights(tuples,weights,total);
  }

  // The exact valid-output space of one configuration: the allowed tuples, their exact weights
  // and the exact total. The key covers every input that influences the weights, so the cache
  // can only ever return the space of the very configuration it was asked for.
  let passwordSpaceCache=null;
  function passwordSpace(length, sizes, flags) {
    const key=length+"|"+sizes.lower+"|"+sizes.upper+"|"+sizes.digits+"|"+sizes.symbols+"|"
      +(flags.numbersEnabled?1:0)+(flags.symbolsEnabled?1:0)+"|"
      +flags.minDigits+"|"+flags.maxDigits+"|"+flags.minSymbols+"|"+flags.maxSymbols;
    if(passwordSpaceCache&&passwordSpaceCache.key===key) return passwordSpaceCache;
    const tuples=allowedClassCounts(length,sizes,flags);
    const weights=[];
    let total=0n;
    for(const tuple of tuples) {
      const weight=tupleOutputCount(tuple,sizes);
      weights.push(weight);
      total+=weight;
    }
    passwordSpaceCache={key,tuples,weights,total};
    return passwordSpaceCache;
  }

  // Applies the length rule's step 3 to a pair of minimums. Exactly one lowercase and one
  // uppercase are reserved, so the digit and symbol minimums may use the whole reserved room:
  //     minDigits + minSymbols <= cap   (cap = length - 2)
  // Nothing is reduced while that holds, so length 8 with 3 digits + 3 symbols stays 3 + 3
  // (3 + 3 + 1 + 1 = 8 is a complete password). When a reduction is needed, the class that was
  // NOT edited last gives way first, and an enabled class never drops below 1.
  function fitPasswordMinimums(minDigits, minSymbols, cap, numbersEnabled, symbolsEnabled, preferDigits) {
    let digits=numbersEnabled?Math.min(clampInteger(minDigits,1,20),cap):0;
    let symbols=symbolsEnabled?Math.min(clampInteger(minSymbols,1,20),cap):0;
    if(!numbersEnabled||!symbolsEnabled||digits+symbols<=cap) return {minDigits:digits,minSymbols:symbols};
    if(preferDigits) {
      symbols=Math.max(1,cap-digits);
      digits=Math.min(digits,cap-symbols);
    } else {
      digits=Math.max(1,cap-symbols);
      symbols=Math.min(symbols,cap-digits);
    }
    return {minDigits:digits,minSymbols:symbols};
  }

  // Deterministic reconciliation of the password limits ("latest edit wins", no popups):
  // an enabled class can never be capped at 0, one lowercase and one uppercase are always
  // reserved (that is the whole meaning of cap = length - 2), and the digit and symbol minimums
  // may use that entire reserved room: minDigits + minSymbols <= cap.
  function reconcilePasswordLimits(changed) {
    const length=Number($("#password-length").value);
    const cap=length-2;
    const numbersEnabled=$("#use-numbers").checked, symbolsEnabled=$("#use-symbols").checked;
    let minDigits=numbersEnabled?Number.parseInt($("#min-numbers").value,10)||1:0;
    let minSymbols=symbolsEnabled?Number.parseInt($("#min-symbols").value,10)||1:0;
    let maxDigits=numbersEnabled?readMaxLimit($("#max-numbers")):null;
    let maxSymbols=symbolsEnabled?readMaxLimit($("#max-symbols")):null;
    // A finite maximum can never exceed the physically possible count of its class (n - 2).
    if(maxDigits!==null) maxDigits=Math.min(Math.max(1,maxDigits),cap);
    if(maxSymbols!==null) maxSymbols=Math.min(Math.max(1,maxSymbols),cap);
    // Latest edit wins, but only when the ordering actually needs correcting: an edited maximum
    // pulls its minimum down, an edited minimum pushes its maximum up.
    if(numbersEnabled&&maxDigits!==null&&minDigits>maxDigits) {
      if(changed===$("#max-numbers")) minDigits=maxDigits; else maxDigits=minDigits;
    }
    if(symbolsEnabled&&maxSymbols!==null&&minSymbols>maxSymbols) {
      if(changed===$("#max-symbols")) minSymbols=maxSymbols; else maxSymbols=minSymbols;
    }
    // The class whose minimum was edited last is the one that is kept; a length edit (or any
    // other edit) keeps the larger minimum, so the smaller one gives way.
    const editedDigits=changed===$("#min-numbers"), editedSymbols=changed===$("#min-symbols");
    const preferDigits=editedDigits?true:(editedSymbols?false:minDigits>=minSymbols);
    const fitted=fitPasswordMinimums(minDigits,minSymbols,cap,numbersEnabled,symbolsEnabled,preferDigits);
    minDigits=fitted.minDigits; minSymbols=fitted.minSymbols;
    // A finite maximum stays inside [minimum, cap]: never below its minimum, never above the
    // physically possible count.
    if(numbersEnabled&&maxDigits!==null) maxDigits=Math.min(Math.max(maxDigits,minDigits),cap);
    if(symbolsEnabled&&maxSymbols!==null) maxSymbols=Math.min(Math.max(maxSymbols,minSymbols),cap);
    $("#min-numbers").value=numbersEnabled?String(minDigits):"0";
    $("#min-symbols").value=symbolsEnabled?String(minSymbols):"0";
    $("#max-numbers").value=(!numbersEnabled||maxDigits===null)?"":String(maxDigits);
    $("#max-symbols").value=(!symbolsEnabled||maxSymbols===null)?"":String(maxSymbols);
  }

  function generatePassword() {
    const length=Number($("#password-length").value), g=passwordGroups();
    lastPasswordLength=length;
    if (!g.lower.length || !g.upper.length) return;
    // An ENABLED special-character class with an empty usable alphabet is a configuration error,
    // not "symbols disabled": nothing is generated and the user is told what to fix. (The enabled
    // state is never inferred from the alphabet size - see allowedClassCounts.)
    if (g.useSymbols && !g.symbols.length) { $("#password-result").textContent=t("password.needSymbol"); lastPasswordBits=0; showQuality(0,$("#password-bits"),$("#password-quality")); return; }
    const sizes={lower:g.lower.length,upper:g.upper.length,digits:g.numbers.length,symbols:g.symbols.length};
    const flags={
      numbersEnabled:g.useNumbers, symbolsEnabled:g.useSymbols,
      minDigits:g.useNumbers?clampInteger($("#min-numbers").value,1,20):0,
      maxDigits:g.useNumbers?readMaxLimit($("#max-numbers")):null,
      minSymbols:g.useSymbols?clampInteger($("#min-symbols").value,1,20):0,
      maxSymbols:g.useSymbols?readMaxLimit($("#max-symbols")):null
    };
    // The exact valid-output space (allowed tuples, their exact weights and their exact total) is
    // the single source for the draw AND the entropy, so the two can never describe different
    // spaces; passwordSpace() also caches it per configuration.
    const space=passwordSpace(length,sizes,flags);
    // Defensive: reconciliation keeps this unreachable. With no allowed tuple the active
    // constraints cannot be satisfied at this length, so nothing is generated.
    if(!space.tuples.length) { $("#password-result").textContent=""; lastPasswordBits=0; showQuality(0,$("#password-bits"),$("#password-quality")); return; }
    const counts=sampleTupleFromWeights(space.tuples,space.weights,space.total);
    const out=[];
    for(let i=0;i<counts.lower;i++) out.push(pick(g.lower));
    for(let i=0;i<counts.upper;i++) out.push(pick(g.upper));
    for(let i=0;i<counts.digits;i++) out.push(pick(g.numbers));
    for(let i=0;i<counts.symbols;i++) out.push(pick(g.symbols));
    if(out.length!==length) return;   // cannot happen; never display a wrong-length value
    $("#password-result").textContent=secureShuffle(out).join("");
    // Exact entropy of the displayed generation process: log2 of the very same valid-output count.
    lastPasswordBits=log2BigInt(space.total);
    showQuality(lastPasswordBits,$("#password-bits"),$("#password-quality"));
  }

  function log2Combination(n,k) { if(k<0||k>n)return -Infinity; k=Math.min(k,n-k); let r=0; for(let i=1;i<=k;i++) r+=Math.log2(n-k+i)-Math.log2(i); return r; }
  function randomDigitString(length) { let s=""; for(let i=0;i<length;i++) s+=String(secureRandomInt(10)); return s; }

  let phraseCandidates = [];
  let candidateRows = [];
  let activeCapitalMode = "none";

  // The "separator characters" field is the single source of truth; the buttons only edit it.
  // In this field the exact string "123" is the only representation of the random digit
  // separator (RANDOM_DIGIT). Any other digit is an invalid literal, while non-digit
  // characters are literal separators.
  const RANDOM_DIGIT_TOKEN="123";

  function parseSeparatorField() {
    let rest=$("#separator-chars").value, randomDigit=false;
    if(rest.includes(RANDOM_DIGIT_TOKEN)) {
      randomDigit=true;
      // Any further occurrence refers to the same SINGLE token and does not increase the weighting.
      rest=rest.split(RANDOM_DIGIT_TOKEN).join("");
    }
    const literals=[...new Set([...rest].filter(ch=>!/[0-9]/.test(ch)))];
    return {literals,randomDigit};
  }

  // The available separators are the literal characters plus, optionally, the random digit
  // (null), so "123" counts as exactly ONE choice - not ten, and not three.
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

  // Unicode-aware length: every visible character counts as one (per code point).
  function characterLength(text) { return [...text].length; }

  // The separators of a single candidate (one per word boundary), so that its length is
  // computable and rejection against the maximum length is meaningful.
  function rollCandidateSeparators(candidate) {
    const options=separatorOptions();
    candidate.separators=Array.from({length:Math.max(0,candidate.words.length-1)},()=>options.length?renderSeparator(pick(options)):"");
  }

  // Canonical form: the "123" token appears at most once, every other digit (even a partial
  // fragment) disappears, and the order of the literals and the caret position are preserved.
  function normalizeSeparatorField() {
    const input=$("#separator-chars");
    const raw=input.value;
    let out="", tokenUsed=false;
    for(let i=0;i<raw.length;) {
      if(!tokenUsed && raw.startsWith(RANDOM_DIGIT_TOKEN,i)) {
        out+=RANDOM_DIGIT_TOKEN; tokenUsed=true; i+=RANDOM_DIGIT_TOKEN.length; continue;
      }
      const ch=raw[i++];
      if(/[0-9]/.test(ch)) continue;   // a digit is not valid as a literal separator
      if(out.includes(ch)) continue;   // no duplicate literal
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
      // The "123" button has no data-sep attribute: its state is the exact token in the field.
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

  // The "123" button writes the exact token into the field or removes it from there (no separate state).
  function toggleRandomDigitSeparator() {
    const input=$("#separator-chars");
    if(parseSeparatorField().randomDigit) input.value=input.value.split(RANDOM_DIGIT_TOKEN).join("");
    else input.value+=RANDOM_DIGIT_TOKEN;
    normalizeSeparatorField();
    if(input.setSelectionRange) input.setSelectionRange(input.value.length,input.value.length);
    syncSeparatorButtons();
    rerollSeparatorsAndRender();
  }

  // The word pool of a single candidate (up to the maximum of the "number of words" slider), so
  // that changing the word count does not re-draw the words already displayed.
  function buildCandidateWordPool() {
    const maxWords=Number($("#word-count").max) || 10;
    return Array.from({length:maxWords},()=>pick(hungarianWords));
  }

  // "Guaranteed numbers" presets: they drive the existing number-block fields.
  const NUMBER_PRESETS={none:{blocks:0,min:1,max:1},one:{blocks:1,min:1,max:1},two:{blocks:2,min:1,max:1}};

  function numberPreset() {
    const checked=document.querySelector('input[name="number-preset"]:checked');
    return checked ? checked.value : "none";
  }

  function syncNumberPresetRow() {
    $("#custom-number-settings").hidden=numberPreset()!=="custom";
  }

  // When switching presets, the existing words/word pools are preserved; only the guaranteed numbers are regenerated.
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

  // Read the structural settings once for all candidates, clamping the input fields back into range as needed.
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

  // ---- Website requirements: VALIDATION, not a generator setting ----
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

  // Special character: not a letter, not a digit and not whitespace. A space is NOT a special character.
  function hasSpecialCharacter(text) { return [...text].some(ch=>!/[\p{L}\p{N}\s]/u.test(ch)); }

  // Checks the ACTUAL generated text (not the settings and not the available options).
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

  // The actual, copyable text: words + number blocks + separators + capitalization.
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

  // A new candidate that respects the maximum length: the COMPLETE candidate (words, numbers,
  // separators, capitalization) is built and discarded when it is longer than the maximum.
  // Nothing is truncated or shortened; if the limit cannot be met, the last (too long)
  // candidate is kept and the compatibility check reports the overshoot.
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

  // Compact feedback about the website requirements (the distinct shortcomings of the visible candidates).
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

  // The collapsed accordion summaries (display only; nothing is generated).
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

  // The status column: entropy · length / quality / website compatibility.
  function updateCandidateStatus(index,phrase) {
    const candidate=phraseCandidates[index], row=candidateRows[index];
    const bits=candidateBits(candidate);
    const quality=qualityForBits(bits);
    const check=checkWebsiteRequirements(phrase);
    row.bits.textContent=t("candidate.status",{bits:Math.round(bits),length:characterLength(phrase)});
    row.quality.textContent=quality.label;
    row.quality.className=`quality ${quality.c}`;
    window.PWGEN_STRENGTH.fillMeter(row.meter,quality.c);
    row.compat.hidden=!websiteRequirementsActive();
    row.compat.textContent=check.ok?t("compat.ok"):t("compat.bad");
    row.compat.className=`compat ${check.ok?"ok":"bad"}`;
  }

  // ---- Entropy explanation (ⓘ) ----
  const SUPERSCRIPT_DIGITS={"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹"};
  let entropyInfoIndex=null, entropyInfoTrigger=null;

  function superscriptNumber(value) {
    return [...String(value)].map(ch=>SUPERSCRIPT_DIGITS[ch] ?? ch).join("");
  }

  // The exact value of 2^bits using BigInt; null when it is too long (then only 2^N is shown).
  function decimalPossibilities(bits,maxDigits=50) {
    if(!Number.isInteger(bits) || bits<0 || bits>512) return null;
    const text=(2n**BigInt(bits)).toString();
    if(text.length>maxDigits) return null;
    return text.replace(/\B(?=(\d{3})+$)/g," ");
  }

  // The explanation panel content is shared: candidates pass their own generation entropy,
  // and the Password tab passes the generation entropy of the displayed password.
  // passphraseContext marks content that only makes sense for the Passphrase generator
  // (the maximum-length caveat and the "one more random word" tip), so opening the panel
  // from the Password tab can never show passphrase-specific advice.
  function fillEntropyInfoForBits(bits, options) {
    const passphraseContext=!!(options && options.passphraseContext);
    $("#entropy-info-value").textContent=t("entropy.value",{bits,sup:superscriptNumber(bits)});
    const decimal=decimalPossibilities(bits);
    const countLine=$("#entropy-info-count");
    countLine.hidden=decimal===null;
    countLine.textContent=decimal===null?"":t("entropy.count",{count:decimal});
    // The maximum length is a Passphrase setting, so its caveat is shown only in that context.
    $("#entropy-info-caveat").hidden=!(passphraseContext && activeMaxLength()!==null);
    const moreWords=$("#entropy-info-more-words");
    if(moreWords) moreWords.hidden=!passphraseContext;
  }

  function fillEntropyInfo(candidate) {
    fillEntropyInfoForBits(Math.round(candidateBits(candidate)),{passphraseContext:true});
  }

  // The single explanation panel is moved to the tab that opened it, so both tabs keep
  // their own layout and no second dialog is created. For the Passphrase tab this is the
  // exact position the panel already has in the HTML (before the action row), so nothing
  // changes there.
  function mountEntropyInfoBefore(element) {
    const panel=$("#entropy-info");
    if(panel && element && element.parentNode) element.parentNode.insertBefore(panel,element);
  }
  function mountEntropyInfoAfter(element) {
    const panel=$("#entropy-info");
    if(panel && element && element.parentNode) element.parentNode.insertBefore(panel,element.nextSibling);
  }

  function openEntropyInfo(index) {
    const candidate=phraseCandidates[index];
    if(!candidate || !candidateRows[index]) return;
    if(entropyInfoTrigger) entropyInfoTrigger.setAttribute("aria-expanded","false");
    entropyInfoIndex=index;
    entropyInfoTrigger=candidateRows[index].info;
    fillEntropyInfo(candidate);
    mountEntropyInfoBefore($(".phrase-actions"));
    $("#entropy-info").hidden=false;
    entropyInfoTrigger.setAttribute("aria-expanded","true");
    const close=$("#entropy-info-close");
    if(close && close.focus) close.focus();
  }

  // Same panel and same explanation, opened from the Password tab's compact metadata line.
  function openPasswordEntropyInfo() {
    if(lastPasswordBits===null) return;
    if(entropyInfoTrigger) entropyInfoTrigger.setAttribute("aria-expanded","false");
    entropyInfoIndex=null;
    entropyInfoTrigger=$("#password-info");
    fillEntropyInfoForBits(Math.round(lastPasswordBits));
    mountEntropyInfoAfter($("#password-result-area"));
    $("#entropy-info").hidden=false;
    if(entropyInfoTrigger) entropyInfoTrigger.setAttribute("aria-expanded","true");
    const close=$("#entropy-info-close");
    if(close && close.focus) close.focus();
  }

  function togglePasswordEntropyInfo() {
    if(entropyInfoTrigger===$("#password-info")) closeEntropyInfo(true);
    else openPasswordEntropyInfo();
  }

  // Closing always restores the panel's home position (its original place in the
  // Passphrase panel), so the shared panel never stays inside whichever tab opened it.
  function closeEntropyInfo(restoreFocus) {
    if(entropyInfoTrigger) {
      if(restoreFocus && entropyInfoTrigger.focus) entropyInfoTrigger.focus();
      entropyInfoTrigger.setAttribute("aria-expanded","false");
      entropyInfoTrigger=null;
    }
    entropyInfoIndex=null;
    $("#entropy-info").hidden=true;
    mountEntropyInfoBefore($(".phrase-actions"));
  }

  function toggleEntropyInfo(index) {
    if(entropyInfoIndex===index && entropyInfoTrigger) closeEntropyInfo(true);
    else openEntropyInfo(index);
  }

  // Refreshing the open explanation (after regeneration or a settings change).
  function refreshEntropyInfo() {
    if(!entropyInfoTrigger) return;
    if(entropyInfoIndex===null) {                       // opened from the Password tab
      if(lastPasswordBits!==null) fillEntropyInfoForBits(Math.round(lastPasswordBits));
      return;
    }
    const candidate=phraseCandidates[entropyInfoIndex];
    if(!candidate) { closeEntropyInfo(false); return; }
    fillEntropyInfo(candidate);
  }

  // The separator setting changed: draw new separators, then re-render
  // (the words, the guaranteed numbers and the capitalization target stay unchanged).
  function rerollSeparatorsAndRender() {
    phraseCandidates.forEach(rollCandidateSeparators);
    renderCandidates();
  }

  // Capitalization: the mode comes from the control, the random target is stored in the candidate state.
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

  // A new random target for every visible candidate (entering a random mode).
  function rerollCapitalTargets() {
    phraseCandidates.forEach(candidate=>{ candidate.capTarget=secureRandomInt(candidate.words.length); });
  }

  // The new random content of a single candidate: words + number blocks (value and position).
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

    // Keeping the random capitalization target while it is valid (e.g. when only the number blocks change).
    const target=(Number.isInteger(capTarget) && capTarget>=0 && capTarget<settings.count)
      ? capTarget
      : secureRandomInt(settings.count);

    return {pool,words,baseBits,capTarget:target};
  }

  function candidateTarget() { return clampInteger($("#candidate-count").value,1,5); }

  // Handling the slider: existing candidates are kept, only the missing ones are added (or the
  // surplus is trimmed), and only the new candidates are rendered.
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

  // New content for every candidate; the existing word pool is kept (when the word count or the
  // number blocks change), while a full regeneration gives every candidate a new word pool.
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

  // The number of rows follows the number of candidates: existing rows are not rebuilt.
  function ensureCandidateRows(count) {
    while(candidateRows.length<count) {
      const row=document.createElement("div"); row.className="phrase-row";
      const text=document.createElement("div"); text.className="result";
      const strength=document.createElement("div"); strength.className="strength-block";
      const bitsLine=document.createElement("span"); bitsLine.className="bits-line";
      const bits=document.createElement("span"); bits.className="bits";
      const info=document.createElement("button");
      info.type="button"; info.className="info-btn"; info.textContent="ⓘ";
      info.setAttribute("aria-label",t("entropy.infoAria"));
      info.setAttribute("aria-expanded","false");
      bitsLine.appendChild(bits); bitsLine.appendChild(info);
      const meter=document.createElement("span"); meter.className="meter meter-sm"; meter.setAttribute("aria-hidden","true");
      for(let i=0;i<6;i++) meter.appendChild(document.createElement("span"));
      const qualityLine=document.createElement("span"); qualityLine.className="quality-line";
      const quality=document.createElement("span"); quality.className="quality";
      const compat=document.createElement("span"); compat.className="compat"; compat.hidden=true;
      qualityLine.appendChild(meter); qualityLine.appendChild(quality);
      strength.appendChild(bitsLine); strength.appendChild(qualityLine); strength.appendChild(compat);
      const button=document.createElement("button"); button.type="button"; button.className="copy"; button.textContent=t("actions.copy");
      button.addEventListener("click",()=>copyText(text.textContent));
      const index=candidateRows.length;
      info.addEventListener("click",event=>{ if(event&&event.stopPropagation) event.stopPropagation(); toggleEntropyInfo(index); });
      row.appendChild(text); row.appendChild(strength); row.appendChild(button);
      $("#phrase-list").appendChild(row);
      candidateRows.push({row,text,bits,bitsLine,info,meter,quality,compat,button});
    }
    while(candidateRows.length>count) candidateRows.pop().row.remove();
  }

  // Rendering one candidate: the STORED words/number blocks/separators + the current capitalization.
  function renderCandidate(index) {
    const candidate=phraseCandidates[index];
    if(!candidate || !candidateRows[index]) return;

    const phrase=candidatePhrase(candidate);
    candidateRows[index].text.textContent=phrase;
    updateCandidateStatus(index,phrase);
  }

  // The entropy of one candidate: the same formula, evaluated per candidate.
  // "123" counts as exactly one choice (log2 N); the digit it produces (log2 10) is
  // deliberately not included, so the estimate stays conservative.
  // WARNING: rejection against the maximum length narrows the set of accepted outputs,
  // and this estimate does NOT include that. Conditional entropy would require knowing the
  // acceptance probability, so the displayed value is the unconditional estimate (an upper
  // bound), not the entropy of the length-constrained distribution.
  function candidateBits(candidate) {
    const options=separatorOptionCount();
    let bits=candidate.baseBits;
    if(options>1) bits+=(candidate.words.length-1)*Math.log2(options);
    return bits;
  }

  function hidePhraseMessage() { $("#phrase-message").hidden=true; }

  // Re-rendering every candidate (separator or capitalization change).
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
    phraseCandidates=[];   // every candidate gets a new word pool
    rebuildCandidates();
  }

  // Three tabs: the selected panel is visible, the others are hidden. Leaving the
  // "Password Check" tab clears every entered value and analysis (privacy behaviour).
  const TAB_IDS = { phrase: ["#phrase-tab", "#phrase-panel"], password: ["#password-tab", "#password-panel"], check: ["#check-tab", "#check-panel"] };
  function switchTab(name) {
    // A tab switch must never leave the shared explanation panel open inside the panel
    // that is being hidden (and must not leave a stale aria-expanded on its trigger).
    closeEntropyInfo(false);
    Object.keys(TAB_IDS).forEach(key => {
      const [tabSelector, panelSelector] = TAB_IDS[key];
      $(tabSelector).setAttribute("aria-selected", key === name);
      $(panelSelector).hidden = key !== name;
    });
    if (name !== "check" && window.PWGEN_CHECK) window.PWGEN_CHECK.reset();
  }
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
      renderWordListSize();
      $("#generate-phrase").disabled=false;
      generatePassphrase();
    } catch(err) {
      console.error(err);
      $("#phrase-message").textContent=t("error.wordListLoadFailed");
      $("#phrase-message").hidden=false;
    }
  }

  // Keeps the two limit controls of a category in sync with that category, and writes the
  // canonical min/max values back into the DOM. The actual limit reconciliation is
  // deterministic and lives in reconcilePasswordLimits(); this function only enables/disables
  // and clamps, so it is safe to call while the user is still editing.
  function syncPasswordLimits() {
    const numbersEnabled = $("#use-numbers").checked;
    const symbolsEnabled = $("#use-symbols").checked;

    $("#min-numbers").disabled = !numbersEnabled;
    $("#max-numbers").disabled = !numbersEnabled;
    $("#min-symbols").disabled = !symbolsEnabled;
    $("#max-symbols").disabled = !symbolsEnabled;

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

    if (numbersEnabled) {
      const maxDigits = readMaxLimit($("#max-numbers"));
      $("#max-numbers").value = maxDigits === null ? "" : String(maxDigits);
    } else {
      $("#max-numbers").value = "";
    }
    if (symbolsEnabled) {
      const maxSymbols = readMaxLimit($("#max-symbols"));
      $("#max-symbols").value = maxSymbols === null ? "" : String(maxSymbols);
    } else {
      $("#max-symbols").value = "";
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
  $("#check-tab").addEventListener("click",()=>switchTab("check"));
  $("#phrase-tab").addEventListener("click",()=>switchTab("phrase"));
  $("#generate-password").addEventListener("click",generatePassword);
  $("#generate-phrase").addEventListener("click",generatePassphrase);
  $("#password-length").addEventListener("input",e=>{$("#password-length-value").value=e.target.value;});
  // Commit: reconcile the limits against the final length, then exactly one generation.
  $("#password-length").addEventListener("change",()=>{reconcilePasswordLimits($("#password-length"));generatePassword();});
  ["#use-numbers","#use-symbols"].forEach(id=>$(id).addEventListener("change",()=>{syncPasswordLimits();reconcilePasswordLimits($(id));generatePassword();}));   // commit: sync limits, then exactly one generation
  $("#avoid-ambiguous").addEventListener("change",generatePassword);
  // While editing, only the deterministic UI state is kept in sync (display only, no draw).
  ["#min-numbers","#min-symbols","#max-numbers","#max-symbols"].forEach(id=>$(id).addEventListener("input",()=>{syncPasswordLimits();}));
  // Commit: "latest edit wins" reconciliation, then exactly one generation.
  ["#min-numbers","#min-symbols","#max-numbers","#max-symbols"].forEach(id=>$(id).addEventListener("change",()=>{syncPasswordLimits();reconcilePasswordLimits($(id));generatePassword();}));
  $("#symbol-set").addEventListener("input",()=>{});   // nothing to validate while typing
  $("#symbol-set").addEventListener("change",generatePassword);   // commit: apply once
  $("#candidate-count").addEventListener("input",e=>{ $("#candidate-count-value").value=e.target.value; });   // live number only
  $("#candidate-count").addEventListener("change",syncCandidateCount);                                       // commit: rebuild once with the final count
  $("#word-count").addEventListener("input",e=>{
    $("#word-count-value").value=e.target.value;
    syncPhraseNumberBlocks();       // deterministic: keeps the guaranteed-number UI valid while dragging
  });
  $("#word-count").addEventListener("change",rebuildCandidates);   // commit: regenerate once with the final word count
  document.querySelectorAll(".sep-btn").forEach(button=>{
    // The "123" button has no data-sep attribute: it toggles the random digit separator.
    if(button.dataset.sep===undefined) button.addEventListener("click",toggleRandomDigitSeparator);
    else button.addEventListener("click",()=>toggleSeparatorChar(button.dataset.sep));
  });
  document.querySelectorAll('input[name="number-preset"]').forEach(radio=>{
    radio.addEventListener("change",()=>applyNumberPreset(numberPreset()));
  });
  document.querySelectorAll('input[name="max-length"]').forEach(radio=>{
    radio.addEventListener("change",()=>{
      generationLengthFailure=null;   // the warning referred to the last generation
      syncMaxLengthRow();
      updateLengthWarning();
      renderCandidates();             // recalculates only: it does not generate and does not truncate
    });
  });
  $("#max-length-custom").addEventListener("input",()=>{
    generationLengthFailure=null;
    updateLengthWarning();          // display only while typing
  });
  // Committed custom maximum length: recalculate/re-filter the existing candidates once.
  // renderCandidates() is deterministic here: it does not generate and does not truncate.
  $("#max-length-custom").addEventListener("change",renderCandidates);
  ["#require-upper","#require-digit","#require-special","#forbid-space"].forEach(id=>{
    $(id).addEventListener("change",renderCandidates);   // recalculates only, does not generate
  });
  // Exclusive accordion: only ONE settings section can be open at a time (display only).
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
  // Entropy explanation: the ⓘ button opens/closes it; an outside click or Escape closes it.
  $("#entropy-info-close").addEventListener("click",()=>closeEntropyInfo(true));
  $("#password-info").addEventListener("click",event=>{
    if(event && event.stopPropagation) event.stopPropagation();
    togglePasswordEntropyInfo();
  });
  document.addEventListener("click",event=>{
    if(!entropyInfoTrigger) return;
    const panel=$("#entropy-info");
    if(panel.contains && event.target && panel.contains(event.target)) return;
    closeEntropyInfo(false);
  });
  document.addEventListener("keydown",event=>{ if(event.key==="Escape") closeEntropyInfo(true); });
  $("#separator-chars").addEventListener("input",()=>{
    normalizeSeparatorField();      // filtering/normalisation only while typing
    syncSeparatorButtons();
  });
  // Committed separator set: draw the separators once. Enter fires change natively, so
  // committing with Enter does not trigger a second regeneration on blur.
  $("#separator-chars").addEventListener("change",rerollSeparatorsAndRender);
  document.querySelectorAll('input[name="capital-mode"]').forEach(radio=>{
    radio.addEventListener("change",()=>{
      const mode=capitalMode();
      // New targets are drawn only when moving from a non-random mode into a random one.
      if(isRandomCapitalMode(mode) && !isRandomCapitalMode(activeCapitalMode)) rerollCapitalTargets();
      activeCapitalMode=mode;
      renderCandidates();
    });
  });
  // While typing, only the dependent UI (min/max/count validity) is kept in sync;
  // candidate generation waits for the committed value.
  ["#number-block-count","#number-min-digits","#number-max-digits"].forEach(id=>$(id).addEventListener("input",event=>{
    syncPhraseNumberBlocks(event.target);
  }));
  ["#number-block-count","#number-min-digits","#number-max-digits"].forEach(id=>$(id).addEventListener("change",rebuildCandidates));
  document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",()=>copyResult(b.dataset.copy)));

  // Language switch: ONLY the visible texts are refreshed. No new password or passphrase is
  // generated, no new separator, number block or capitalization target is drawn, and the values
  // already displayed stay unchanged character for character.
  function refreshPasswordStatus() {
    if(lastPasswordBits===null) return;
    showQuality(lastPasswordBits,$("#password-bits"),$("#password-quality"));
  }
  // Word-list size: display only. It formats the already loaded array with the current
  // document language, so a language switch re-formats the number without reloading the
  // word list and without touching any generated value.
  function renderWordListSize() {
    if(!hungarianWords.length) return;
    const size=$("#word-list-size");
    if(size) size.textContent=hungarianWords.length.toLocaleString(document.documentElement.lang || "hu-HU");
  }
  function refreshTextsOnLanguageChange() {
    candidateRows.forEach(row=>{
      row.button.textContent=t("actions.copy");
      row.info.setAttribute("aria-label",t("entropy.infoAria"));
    });
    renderCandidates();          // display only: re-rendering the stored candidates
    updateLengthWarning();
    refreshPasswordStatus();
    renderWordListSize();
    refreshEntropyInfo();        // the shared explanation panel follows the UI language too
    if (window.PWGEN_CHECK) window.PWGEN_CHECK.relabel();
    const message=$("#phrase-message");
    if(!hungarianWords.length && message && !message.hidden) message.textContent=t("error.wordListLoadFailed");
  }
  if(window.PWGEN_L10N) window.PWGEN_L10N.onLanguageChange(refreshTextsOnLanguageChange);

  activeCapitalMode=capitalMode();
  syncNumberPresetRow();
  syncMaxLengthRow();
  updateLengthWarning();
  updateSettingSummaries();
  syncPasswordLimits();
  reconcilePasswordLimits(null);
  syncPhraseNumberBlocks();
  syncSeparatorButtons();
  switchTab("phrase");
  generatePassword();
  loadWordList();
