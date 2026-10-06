#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rank_candidates.py - STAGE 2: rank the Stage-1 Hungarian passphrase candidates by
real corpus usage frequency (Hungarian Webcorpus 2 by Peter Racz / Nemeskey).

What it does
------------
  1. reads the Stage-1 mechanically cleaned pool
     (tools/wordlist_analysis/candidate_words.txt),
  2. reads the current production word list from lang/hun.js (READ ONLY),
  3. matches every candidate to corpus lemmas/forms conservatively,
  4. ranks the candidates by corpus frequency (lemma frequency preferred),
  5. applies quality safety filters to NEW words only,
  6. builds protected pools of 12k / 16k / 20k / 25k that always contain
     every current production word,
  7. writes a machine-readable ranked table, per-pool review samples and a
     report.

Nothing in this script writes to lang/hun.js or index.html. The production
word list is not replaced here.

Frequency source
----------------
The script does NOT invent frequencies. Every value in the output comes from
the frequency file you pass with --freq. Column roles are auto-detected from
the header, so any of these layouts works:

  * the Webcorpus 2 derived lemma table:
        lemma  lemma_freq  llfpm10  form  freq  form_length  lemma_length
  * a lemma-only table:
        lemma  lemma_freq  llfpm10
  * a form-only table (e.g. the older Webcorpus 2.2 frequency dictionary):
        form  freq

Matching rules
--------------
  * NFC normalize both sides (the Stage-1 pool is already NFC),
  * compare case-insensitively with str.lower(),
  * Hungarian accents are preserved, never transliterated, never stemmed,
  * only exact (normalized, case-folded) key equality counts as a match.
Anything else is reported as unmatched - it is never given a made-up value.

Usage
-----
    python tools/rank_candidates.py --freq path/to/webcorpus2_lemma_freq.tsv

    # explicit roles if the header is unusual:
    python tools/rank_candidates.py --freq f.tsv \
        --lemma-col lemma --lemma-freq-col lemma_freq --llfpm-col llfpm10

    # form-only source (ranking is then form-based, and the report says so):
    python tools/rank_candidates.py --freq web2.2-freq-sorted.txt --form-col 0 --freq-col 1

Reuse in another language
-------------------------
Generic: header/column auto-detection, the conservative NFC + case-folded exact
matching, the "never invent a frequency" policy, protected-pool construction,
ranking, sampling and reporting.
Hungarian-specific: the vocabulary constants below (HUNGARIAN_LETTERS, VOWELS,
HUNGARIAN_ALPHABET collation), the proper-name and acronym heuristics, the
default --freq file, lang/hun.js as the protected production list, and the
Hungarian report wording.
For another language: provide that language's frequency table, replace the
alphabet constants (digraphs included) and revisit is_proper_name(),
looks_like_abbreviation() and splits_into_two_words(), which encode Hungarian
capitalisation and orthography conventions.
"""

from __future__ import annotations

import argparse
import csv
import math
import random
import statistics
import sys
import unicodedata
from collections import Counter
from pathlib import Path

SCRIPT_VERSION = "1.0.0"

# --------------------------------------------------------------------------
# Vocabulary constants (kept in sync with tools/build_wordlist.py)
# LANGUAGE-SPECIFIC BLOCK: replace for another language.
# --------------------------------------------------------------------------

HUNGARIAN_LETTERS = set("aábcdeéfghiíjklmnoóöőpqrstuúüűvwxyz")
ASCII_PUNCTUATION = set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
TOKEN_EXTRA = set("'-’")
VOWELS = set("aáeéiíoóöőuúüű")

PREFERRED_MIN_LEN = 4
PREFERRED_MAX_LEN = 12

# digraphs first, so Hungarian collation stays correct
HUNGARIAN_ALPHABET = [
    "a", "á", "b", "c", "cs", "d", "dz", "dzs", "e", "é", "f", "g", "gy",
    "h", "i", "í", "j", "k", "l", "ly", "m", "n", "ny", "o", "ó", "ö", "ő",
    "p", "q", "r", "s", "sz", "t", "ty", "u", "ú", "ü", "ű", "v", "w", "x",
    "y", "z", "zs",
]
_DIGRAPHS = sorted((d for d in HUNGARIAN_ALPHABET if len(d) > 1), key=len, reverse=True)
_LETTER_RANK = {letter: i for i, letter in enumerate(HUNGARIAN_ALPHABET)}
_UNKNOWN_RANK = len(HUNGARIAN_ALPHABET) + 1


def hungarian_sort_key(word: str) -> tuple:
    """Total-order Hungarian collation key (see tools/build_wordlist.py)."""
    lowered = word.lower()
    tokens: list[tuple[int, str, int]] = []
    i, n = 0, len(lowered)
    while i < n:
        for digraph in _DIGRAPHS:
            if lowered.startswith(digraph, i):
                tokens.append((_LETTER_RANK[digraph], digraph, 0))
                i += len(digraph)
                break
        else:
            ch = lowered[i]
            folded = unicodedata.normalize("NFD", ch)
            base = next((c for c in folded if not unicodedata.combining(c)), ch)
            tokens.append((_LETTER_RANK.get(base, _UNKNOWN_RANK), ch, ord(ch)))
            i += 1
    return tuple(tokens) + ((0, "", 0),) + tuple((0, "", ord(c)) for c in word)


def normalize_key(text: str) -> str:
    """NFC + trim + lowercase. Accents are preserved on purpose."""
    return unicodedata.normalize("NFC", text).strip().lower()


# --------------------------------------------------------------------------
# Analysis helpers
# --------------------------------------------------------------------------

def has_accent(word: str) -> bool:
    return any(ch not in "abcdefghijklmnopqrstuvwxyz" for ch in word.lower())


def is_hungarian_letters(word: str) -> bool:
    return all(ch in HUNGARIAN_LETTERS for ch in word)


def looks_like_abbreviation(word: str) -> bool:
    if word.isupper() and len(word) >= 2:
        return True
    letters = [c for c in word if c.isalpha()]
    if len(letters) >= 2 and not any(c.lower() in VOWELS for c in letters):
        return True
    if len(letters) >= 5:
        runs = [len(r) for r in
                __import__("re").findall(r"[^aáeéiíoóöőuúüű]+", word.lower())]
        if runs and max(runs) >= 5:
            return True
    return False


def is_proper_name(source_spelling: str, word: str) -> bool:
    """Conservative: only the SOURCE spelling carries case information.

    A candidate that is capitalised in the source dictionary and is not an
    initialism is treated as a probable proper name / place name. Candidates
    that reached the pool through a lowercase source spelling are not flagged,
    which keeps this rule conservative rather than speculative.
    """
    if word.isupper():
        return False                       # that is the acronym rule
    return bool(source_spelling) and source_spelling[:1].isupper()


def splits_into_two_words(word: str, vocabulary: set[str]) -> bool:
    n = len(word)
    for i in range(3, n - 2):
        if word[:i] in vocabulary and word[i:] in vocabulary:
            return True
    return False


# --------------------------------------------------------------------------
# Input: Stage-1 candidates + their source spellings
# --------------------------------------------------------------------------

def read_candidates(path: Path) -> list[str]:
    words = [w.strip() for w in path.read_text(encoding="utf-8").split("\n")]
    words = [w for w in words if w]
    if not words:
        raise SystemExit(f"no candidates found in {path}")
    return words


def find_production_list(root: Path):
    import re
    skip = {".git", "node_modules", "__pycache__", "wordlist_analysis"}
    pattern = re.compile(r"window\.HU_WORDS\s*=\s*\[(.*?)\]\s*;", re.S)
    for path in sorted(root.rglob("*.js")):
        if any(part in skip for part in path.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="strict")
        m = pattern.search(text)
        if m:
            words = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
            if words:
                return path, words
    return None, []


# --------------------------------------------------------------------------
# Input: frequency table
# --------------------------------------------------------------------------

def parse_number(value: str):
    v = value.strip().replace("\u00a0", "")
    if not v:
        return None
    v = v.replace(" ", "")
    # tolerate both 1234.5 and 1234,5 and scientific notation
    if "," in v and "." not in v:
        v = v.replace(",", ".")
    try:
        return float(v)
    except ValueError:
        return None


class FrequencyTable:
    """Auto-detecting reader for a lemma/form frequency table."""

    def __init__(self) -> None:
        self.header: list[str] = []
        self.lemma_col = self.form_col = None
        self.lemma_freq_col = self.llfpm_col = self.freq_col = None
        self.form_length_col = self.lemma_length_col = None
        self.layout = "unknown"
        self.rows = 0
        self.skipped = 0
        # key -> best (highest) values seen
        self.by_key: dict[str, dict] = {}

    # ---------- column detection ----------
    def detect(self, header: list[str], args) -> None:
        self.header = header
        norm = [h.strip().lower().lstrip("\ufeff") for h in header]

        def find(*names):
            for name in names:
                if name in norm:
                    return norm.index(name)
            for i, h in enumerate(norm):
                for name in names:
                    if name and name in h:
                        return i
            return None

        self.lemma_col = (args.lemma_col if args.lemma_col is not None
                          else find("lemma", "stem", "t lemma"))
        self.form_col = (args.form_col if args.form_col is not None
                         else find("form", "word", "wordform", "surface", "token"))
        self.lemma_freq_col = (args.lemma_freq_col if args.lemma_freq_col is not None
                               else find("lemma_freq", "lemmafrequency", "freq_lemma",
                                         "lemma_count", "lemma_frequency"))
        self.llfpm_col = (args.llfpm_col if args.llfpm_col is not None
                          else find("llfpm10", "llfpm", "logfreq", "log_freq"))
        self.form_length_col = find("form_length", "formlength", "length")
        self.lemma_length_col = find("lemma_length", "lemmalength")
        self.freq_col = (args.freq_col if args.freq_col is not None
                         else find("freq", "frequency", "count", "occurrence"))
        self.lfpm_col = find("lfpm10", "lfpm")
        self.hunspell_col = find("hunspell", "ispell")

        # avoid the generic "freq" matcher stealing a dedicated column
        if self.freq_col in (self.lemma_freq_col, self.llfpm_col):
            self.freq_col = None

        # positional fallback for header-less files
        if self.lemma_col is None and self.form_col is None:
            if len(header) >= 5:
                self.form_col, self.freq_col = 0, 1
            elif len(header) == 2:
                self.form_col, self.freq_col = 0, 1
            else:
                self.form_col = 0

        if self.lemma_col is not None and self.lemma_freq_col is None \
                and self.form_col is not None and self.freq_col is None:
            # 2-column lemma table
            self.lemma_freq_col = self.form_col
            self.form_col = None

        cols = [c for c in (self.lemma_col, self.form_col) if c is not None]
        if not cols:
            raise SystemExit(
                "could not identify a lemma/form column in the frequency file "
                f"(header: {header})\n"
                "pass --lemma-col / --form-col explicitly."
            )
        if not any(c is not None for c in
                   (self.lemma_freq_col, self.freq_col, self.llfpm_col)):
            raise SystemExit(
                "could not identify any frequency column in the frequency file "
                f"(header: {header})\n"
                "pass --lemma-freq-col / --freq-col / --llfpm-col explicitly."
            )
        if self.lemma_col is not None and self.lemma_freq_col is not None:
            self.layout = "lemma"
        elif self.form_col is not None:
            self.layout = "form"

    def add(self, row: list[str]) -> None:
        def cell(idx):
            if idx is None or idx >= len(row):
                return ""
            return row[idx]

        lemma = cell(self.lemma_col).strip()
        form = cell(self.form_col).strip()
        key_source = lemma or form
        if not key_source:
            self.skipped += 1
            return
        key = normalize_key(key_source)
        if not key:
            self.skipped += 1
            return

        record = self.by_key.get(key)
        if record is None:
            record = {"key": key, "lemma": "", "lemma_freq": None,
                      "llfpm10": None, "lfpm10": None, "form": "", "freq": None,
                      "lemma_length": None, "form_length": None,
                      "hunspell": None}
            self.by_key[key] = record

        if lemma and not record["lemma"]:
            record["lemma"] = lemma
        if form and not record["form"]:
            record["form"] = form

        for field, idx in (("lemma_freq", self.lemma_freq_col),
                           ("llfpm10", self.llfpm_col),
                           ("lfpm10", self.lfpm_col),
                           ("freq", self.freq_col),
                           ("lemma_length", self.lemma_length_col),
                           ("form_length", self.form_length_col),
                           ("hunspell", self.hunspell_col)):
            value = parse_number(cell(idx))
            if value is None:
                continue
            current = record[field]
            if current is None:
                record[field] = value
            else:
                # for every numeric field the larger value is the better
                # evidence (lengths, frequencies and the hunspell 0/1 flag)
                record[field] = max(current, value)
        self.rows += 1


def load_frequency_table(path: Path, args) -> FrequencyTable:
    table = FrequencyTable()
    delimiter = args.delimiter or "\t"
    with path.open(encoding=args.freq_encoding, newline="") as handle:
        first = handle.readline()
        handle.seek(0)
        has_header = args.header
        if has_header is None:
            # a header exists when the first row has no purely numeric field
            fields = first.rstrip("\r\n").split(delimiter)
            has_header = not any(parse_number(f) is not None for f in fields[1:])
        if has_header:
            header = [h.strip() for h in first.rstrip("\r\n").split(delimiter)]
            table.detect(header, args)
            handle.readline()
        else:
            header = []
            table.detect([""] * max(2, len(first.split(delimiter))), args)
        for line in handle:
            line = line.rstrip("\r\n")
            if not line:
                continue
            table.add(line.split(delimiter))
    return table


# --------------------------------------------------------------------------
# Ranked record
# --------------------------------------------------------------------------

class Candidate:
    __slots__ = ("word", "source_spelling", "current", "length",
                 "matched", "lemma", "lemma_freq", "llfpm10", "freq",
                 "lfpm10", "hunspell_lemma", "hit_source",
                 "proper_name", "abbreviation", "compound", "excluded",
                 "exclusion_reason", "rank")

    def __init__(self, word: str, source_spelling: str, current: bool) -> None:
        self.word = word
        self.source_spelling = source_spelling
        self.current = current
        self.length = len(word)
        self.matched = False
        self.lemma = ""
        self.lemma_freq = None
        self.llfpm10 = None
        self.freq = None
        self.lfpm10 = None
        self.hunspell_lemma = None
        self.hit_source = ""
        self.proper_name = False
        self.abbreviation = False
        self.compound = False
        self.excluded = False
        self.exclusion_reason = ""
        self.rank = 0

    # ---------- ranking key ----------
    def sort_key(self):
        """Best evidence first, then frequency, then length, then spelling.

        Only absolute corpus counts (lemma_freq, else form freq) drive the
        ordering. llfpm10 is a different unit and is reported but never
        compared against counts. A matched word without any count is kept
        behind counted words; an unmatched word is always last and never
        receives an invented value.
        """
        if self.lemma_freq is not None:
            tier, primary, counted = 0, self.lemma_freq, True
        elif self.freq is not None:
            tier, primary, counted = 1, self.freq, True
        else:
            tier, primary, counted = 2, 0.0, False
        return (0 if self.matched else 1, tier, not counted, -primary,
                self.length, hungarian_sort_key(self.word))

    def effective_frequency(self):
        """The count used for ranking, or None when only llfpm/no value exists."""
        if self.lemma_freq is not None:
            return self.lemma_freq
        if self.freq is not None:
            return self.freq
        return None


# --------------------------------------------------------------------------
# Report helpers
# --------------------------------------------------------------------------

def fmt(value, digits=2):
    if value is None:
        return "n/a"
    if isinstance(value, float):
        if value == int(value) and abs(value) < 1e15:
            return f"{int(value)}"
        return f"{value:.{digits}f}"
    return str(value)


def entropy_lines(size: int) -> list[str]:
    if size <= 0:
        return []
    per_word = math.log2(size)
    return [f"   pool size {size:>6}: {per_word:6.4f} bits/word   "
            f"3 words {3 * per_word:7.4f}   4 words {4 * per_word:7.4f}   "
            f"5 words {5 * per_word:7.4f}"]


def describe(values: list[float]) -> str:
    if not values:
        return "n/a"
    return (f"mean {statistics.mean(values):.1f}, "
            f"median {statistics.median(values):.1f}, "
            f"min {min(values):.0f}, max {max(values):.0f}")


def main(argv=None) -> int:
    project_root = Path(__file__).resolve().parent.parent
    analysis_dir = project_root / "tools" / "wordlist_analysis"

    parser = argparse.ArgumentParser(
        description="Stage 2: rank Hungarian passphrase candidates by corpus frequency.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--freq", type=Path, required=True,
                        help="Frequency table (tsv/csv) from the corpus")
    parser.add_argument("--candidates", type=Path,
                        default=analysis_dir / "candidate_words.txt",
                        help="Stage-1 mechanically cleaned candidate list")
    parser.add_argument("--root", type=Path, default=project_root,
                        help="Project root (used to find lang/hun.js)")
    parser.add_argument("--out-dir", type=Path, default=analysis_dir / "stage2",
                        help="Output directory")
    parser.add_argument("--pools", default="12000,16000,20000,25000",
                        help="Comma-separated pool sizes")
    parser.add_argument("--sample-size", type=int, default=300,
                        help="Words per review sample file")
    parser.add_argument("--seed", type=int, default=20240517,
                        help="Fixed seed for review samples")
    parser.add_argument("--max-len", type=int, default=PREFERRED_MAX_LEN,
                        help="Preferred maximum length for NEW words")
    parser.add_argument("--min-len", type=int, default=PREFERRED_MIN_LEN,
                        help="Preferred minimum length for NEW words")
    parser.add_argument("--min-frequency", type=float, default=1.0,
                        help="Minimum corpus frequency for a NEW word to be eligible")
    parser.add_argument("--long-compound-len", type=int, default=11,
                        help="Length at which a compound is flagged 'very long'")
    parser.add_argument("--rare-frequency", type=float, default=10.0,
                        help="Below this frequency a compound is flagged 'rare'")
    # frequency-file layout overrides
    parser.add_argument("--delimiter", default=None, help="Field delimiter (default: tab)")
    parser.add_argument("--header", dest="header", action="store_true", default=None,
                        help="Force the first row to be a header")
    parser.add_argument("--no-header", dest="header", action="store_false",
                        help="Force the file to have no header row")
    parser.add_argument("--freq-encoding", default="utf-8-sig")
    parser.add_argument("--lemma-col", type=int, default=None)
    parser.add_argument("--form-col", type=int, default=None)
    parser.add_argument("--lemma-freq-col", type=int, default=None)
    parser.add_argument("--llfpm-col", type=int, default=None)
    parser.add_argument("--freq-col", type=int, default=None)
    args = parser.parse_args(argv)

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    pools = [int(p) for p in str(args.pools).split(",") if p.strip()]

    # ---------------- inputs ------------------------------------------------
    if not args.candidates.is_file():
        parser.error(f"Stage-1 candidate list not found: {args.candidates}\n"
                     "run tools/build_wordlist.py first.")
    if not args.freq.is_file():
        parser.error(f"frequency file not found: {args.freq}")

    candidates = read_candidates(args.candidates)
    candidate_set = set(candidates)

    prod_path, current_words = find_production_list(args.root)
    current_keys = {normalize_key(w) for w in current_words}
    protected_missing = sorted(current_keys - {normalize_key(w) for w in candidates})

    # ---------------- source spelling map ----------------------------------
    # Stage 1 wrote candidate_words.txt in lowercase-preferred form. To detect
    # proper names we need the original capitalisation, so recover it from the
    # Hunspell dic when available. Without the dic the flag stays conservative
    # and capitalised words are treated as non-name (never guessed from case
    # that the pool no longer carries).
    import re
    source_spelling: dict[str, str] = {}
    dic_path = project_root / "hu_HU.dic"
    dic_used = False
    if dic_path.is_file():
        dic_used = True
        raw = dic_path.read_text(encoding="utf-8-sig")
        lines = raw.split("\n")
        if lines and re.fullmatch(r"\d+", lines[0].strip()):
            lines = lines[1:]
        for line in lines:
            line = line.strip()
            if not line:
                continue
            base = line.split("\t", 1)[0].split("/", 1)[0].strip()
            base = unicodedata.normalize("NFC", base)
            key = normalize_key(base)
            if not key:
                continue
            prev = source_spelling.get(key)
            # prefer a capitalised spelling so the proper-name rule can fire
            if prev is None or (not prev[:1].isupper() and base[:1].isupper()):
                source_spelling[key] = base

    # ---------------- frequency table --------------------------------------
    table = load_frequency_table(args.freq, args)
    print(f"frequency file : {args.freq}")
    print(f"layout         : {table.layout}")
    print(f"columns        : lemma={table.lemma_col} form={table.form_col} "
          f"lemma_freq={table.lemma_freq_col} llfpm10={table.llfpm_col} "
          f"freq={table.freq_col}")
    print(f"lemmas/forms   : {len(table.by_key)}")

    # ---------------- join + flags -----------------------------------------
    records: list[Candidate] = []
    for word in candidates:
        key = normalize_key(word)
        record = Candidate(word, source_spelling.get(key, ""), key in current_keys)
        hit = table.by_key.get(key)
        if hit is not None:
            record.matched = True
            record.lemma = hit["lemma"]
            record.lemma_freq = hit["lemma_freq"]
            record.llfpm10 = hit["llfpm10"]
            record.lfpm10 = hit["lfpm10"]
            record.freq = hit["freq"] if hit["freq"] is not None else hit["lemma_freq"]
            record.hunspell_lemma = hit["hunspell"]
            record.hit_source = "form" if hit["form"] else "lemma"
        record.proper_name = is_proper_name(record.source_spelling, word)
        record.abbreviation = looks_like_abbreviation(word)
        records.append(record)

    # ---------------- ranking ----------------------------------------------
    records.sort(key=lambda r: r.sort_key())
    for index, record in enumerate(records, start=1):
        record.rank = index

    # ---------------- compound detection + safety filters -------------------
    # only apply the safety filters to NEW words; current words are protected
    for record in records:
        if record.current:
            record.compound = splits_into_two_words(record.word, candidate_set)
            continue

        record.compound = splits_into_two_words(record.word, candidate_set)

        reasons = []
        if record.length < args.min_len or record.length > args.max_len:
            reasons.append(f"length outside {args.min_len}..{args.max_len}")
        if not is_hungarian_letters(record.word):
            reasons.append("non-Hungarian letter")
        if any(ch in ASCII_PUNCTUATION for ch in record.word):
            reasons.append("punctuation")
        if any(ch.isdigit() for ch in record.word):
            reasons.append("digit")
        if record.word.isupper() and len(record.word) >= 2:
            reasons.append("ALL-CAPS acronym")
        if record.abbreviation:
            reasons.append("abbreviation-like")
        if record.proper_name:
            reasons.append("probable proper name")
        if not record.matched:
            reasons.append("no frequency match")
        elif record.effective_frequency() is None:
            reasons.append("no usable frequency value")
        elif record.effective_frequency() < args.min_frequency:
            reasons.append(f"frequency below {args.min_frequency:g}")
        if reasons:
            record.excluded = True
            record.exclusion_reason = ";".join(reasons)

    eligible = [r for r in records if not r.excluded]

    # ---------------- pools -------------------------------------------------
    protected = [r for r in records if r.current]
    protected.sort(key=lambda r: hungarian_sort_key(r.word))
    new_eligible = [r for r in eligible if not r.current]   # already rank-ordered

    pool_info = []
    for size in pools:
        needed = size - len(protected)
        if needed < 0:
            needed = 0
        chosen_new = new_eligible[:needed]
        shortfall = needed - len(chosen_new)
        members = protected + chosen_new
        members.sort(key=lambda r: hungarian_sort_key(r.word))
        pool_words = [r.word for r in members]
        new_words = [r.word for r in chosen_new]

        lengths = [len(w) for w in pool_words]
        new_lengths = [len(w) for w in new_words]
        freqs = [r.effective_frequency() or 0.0 for r in members]
        compounds = sum(1 for r in members if r.compound)
        accented = sum(1 for w in pool_words if has_accent(w))
        unmatched = sum(1 for r in members if not r.matched)
        long_compounds = [r.word for r in members
                          if r.compound and r.length >= args.long_compound_len]
        rare_compounds = [r.word for r in members
                          if r.compound and r.matched
                          and (r.effective_frequency() or 0.0) < args.rare_frequency]

        pool_info.append({
            "size": size,
            "actual_size": len(pool_words),
            "new_count": len(new_words),
            "shortfall": shortfall,
            "words": pool_words,
            "new_words": new_words,
            "mean_length": statistics.mean(lengths) if lengths else 0.0,
            "median_length": statistics.median(lengths) if lengths else 0.0,
            "new_mean_length": statistics.mean(new_lengths) if new_lengths else 0.0,
            "new_median_length": statistics.median(new_lengths) if new_lengths else 0.0,
            "freq_summary": describe([f for f in freqs if f > 0]),
            "freq_median": statistics.median([f for f in freqs if f > 0])
            if any(f > 0 for f in freqs) else 0.0,
            "compounds": compounds,
            "compound_pct": 100 * compounds / len(pool_words) if pool_words else 0.0,
            "accented": accented,
            "accent_pct": 100 * accented / len(pool_words) if pool_words else 0.0,
            "unmatched": unmatched,
            "long_compounds": long_compounds,
            "rare_compounds": rare_compounds,
            "bits_per_word": math.log2(len(pool_words)) if pool_words else 0.0,
        })

    # ---------------- outputs ----------------------------------------------
    written: list[tuple[str, int]] = []

    def emit(path: Path, lines) -> None:
        lines = list(lines)
        path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        written.append((str(path), len(lines)))

    # ranked_candidates.csv
    csv_path = out_dir / "ranked_candidates.csv"
    columns = ["word", "current", "frequency_found", "match_source", "lemma",
               "lemma_freq", "llfpm10", "freq", "lfpm10", "hunspell_lemma",
               "rank", "length", "proper_name_flag",
               "abbreviation_flag", "compound_flag", "excluded",
               "exclusion_reason"]
    columns += [f"selected_{size // 1000}k" for size in pools]
    selected_sets = {info["size"]: set(info["words"]) for info in pool_info}
    def cell(value):
        """Empty string when there is no value, so the CSV stays numeric."""
        if value is None:
            return ""
        return fmt(value)

    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(columns)
        for record in records:
            row = [record.word, "1" if record.current else "0",
                   "1" if record.matched else "0", record.hit_source, record.lemma,
                   cell(record.lemma_freq), cell(record.llfpm10), cell(record.freq),
                   cell(record.lfpm10),
                   "" if record.hunspell_lemma is None
                   else ("1" if record.hunspell_lemma else "0"),
                   record.rank, record.length,
                   "1" if record.proper_name else "0",
                   "1" if record.abbreviation else "0",
                   "1" if record.compound else "0",
                   "1" if record.excluded else "0",
                   record.exclusion_reason]
            row += ["1" if record.word in selected_sets[size] else "0"
                    for size in pools]
            writer.writerow(row)
    ranked_rows = len(records)
    written.append((str(csv_path), ranked_rows))

    # per-pool files and samples
    rng_master = random.Random(args.seed)
    for info in pool_info:
        size = info["size"]
        emit(out_dir / f"pool_{size}.txt", info["words"])
        emit(out_dir / f"pool_{size}_new_only.txt", info["new_words"])

        rng = random.Random(rng_master.randrange(2 ** 32))
        sample = rng.sample(info["words"], min(args.sample_size, len(info["words"])))
        sample.sort(key=hungarian_sort_key)
        emit(out_dir / f"sample_{size}_{args.sample_size}.txt", sample)

        rng = random.Random(rng_master.randrange(2 ** 32))
        new_sample = rng.sample(info["new_words"],
                                min(args.sample_size, len(info["new_words"])))
        new_sample.sort(key=hungarian_sort_key)
        emit(out_dir / f"sample_new_{size}_{args.sample_size}.txt", new_sample)

        if info["long_compounds"] or info["rare_compounds"]:
            emit(out_dir / f"review_compounds_{size}.txt",
                 sorted(set(info["long_compounds"]) | set(info["rare_compounds"]),
                        key=hungarian_sort_key))

    # diagnostics
    emit(out_dir / "excluded_new_words.txt",
         [f"{r.word}\t{r.exclusion_reason}" for r in records
          if r.excluded and not r.current][:200000])
    emit(out_dir / "unmatched_candidates.txt",
         [r.word for r in records if not r.matched])

    # ---------------- report ------------------------------------------------
    L: list[str] = []
    add = L.append
    bar = "=" * 78
    add(bar)
    add("STAGE 2 - FREQUENCY RANKING OF HUNGARIAN PASSPHRASE CANDIDATES".center(78))
    add(bar)
    add("ranking data only; lang/hun.js was NOT modified")
    add("")
    add(f"script version      : {SCRIPT_VERSION}")
    add(f"frequency file      : {args.freq}")
    add("frequency source    : Peter Racz, Word frequency list from the Hungarian")
    add("                      Webcorpus 2 (Nemeskey 2020), CC BY 4.0,")
    add("                      doi:10.5281/zenodo.17508385")
    add("normalization       : NFC + trim + str.lower() on both sides; Hungarian")
    add("                      accents preserved, no transliteration, no stemming;")
    add("                      only exact normalized equality counts as a match")
    add(f"detected layout     : {table.layout} "
        f"(lemma col {table.lemma_col}, form col {table.form_col}, "
        f"lemma_freq col {table.lemma_freq_col}, llfpm10 col {table.llfpm_col}, "
        f"freq col {table.freq_col})")
    add(f"candidate list      : {args.candidates}")
    add(f"production list     : {prod_path}")
    add(f"output directory    : {out_dir}")
    add("")
    add("1) INPUT")
    add(f"   Stage-1 candidates            : {len(candidates)}")
    add(f"   frequency table rows read     : {table.rows}")
    add(f"   distinct lemmas/forms matched : {len(table.by_key)}")
    add(f"   rows skipped (empty key)      : {table.skipped}")
    add(f"   current production words      : {len(current_words)}")
    add(f"   current words in candidate set: {len(current_keys) - len(protected_missing)}")
    add(f"   current words NOT in pool     : {len(protected_missing)}")
    if protected_missing:
        add("     " + ", ".join(protected_missing[:20]))
    add(f"   Hunspell dic used for case    : {dic_used} ({dic_path})")
    add("")
    add("2) FREQUENCY MATCHING (exact normalized key only, nothing invented)")
    matched = [r for r in records if r.matched]
    unmatched = [r for r in records if not r.matched]
    add(f"   matched to frequency data     : {len(matched)} "
        f"({100 * len(matched) / len(records):.1f}%)")
    add(f"   unmatched                     : {len(unmatched)} "
        f"({100 * len(unmatched) / len(records):.1f}%)")
    with_lemma = sum(1 for r in matched if r.lemma_freq is not None)
    with_llfpm = sum(1 for r in matched if r.llfpm10 is not None)
    with_form = sum(1 for r in matched if r.freq is not None)
    without_count = sum(1 for r in matched if r.effective_frequency() is None)
    add(f"     of matched, with lemma_freq : {with_lemma}")
    add(f"     of matched, with llfpm10    : {with_llfpm}")
    add(f"     of matched, with form freq  : {with_form}")
    add(f"     of matched, no count at all : {without_count}")
    add(f"     matched by attested form    : "
        f"{sum(1 for r in matched if r.hit_source == 'form')}")
    add(f"     matched as lemma of a form  : "
        f"{sum(1 for r in matched if r.hit_source == 'lemma')}")
    hunspell_yes = sum(1 for r in matched if r.hunspell_lemma)
    hunspell_known = sum(1 for r in matched if r.hunspell_lemma is not None)
    if hunspell_known:
        add(f"     lemma confirmed by Hunspell : {hunspell_yes} of {hunspell_known} "
            f"(informational; not used for filtering)")
    add("   ranking tiers: 1) lemma_freq, 2) form freq, 3) matched without a")
    add("   count, 4) unmatched. llfpm10 is reported but never compared against")
    add("   counts, because it is a different unit; entries that have only")
    add("   llfpm10 are not eligible to fill pools. Tier 3 is therefore never")
    add("   selected, and unmatched words never are.")
    if not with_lemma and with_form:
        add("   NOTE: this frequency file carries no lemma frequencies, so the")
        add("         ranking is FORM-based. That is stated rather than hidden.")
    add(f"   current words matched         : "
        f"{sum(1 for r in records if r.current and r.matched)} of {len(current_words)}")
    add(f"   unmatched words are ranked last and are never given a value;")
    add(f"   they are listed in unmatched_candidates.txt")
    add("")
    add("3) EXCLUSIONS (applied to NEW words only; current words are protected)")
    excluded_new = [r for r in records if r.excluded and not r.current]
    add(f"   new words excluded            : {len(excluded_new)}")
    reason_counter: Counter[str] = Counter()
    for record in excluded_new:
        for reason in record.exclusion_reason.split(";"):
            if reason:
                reason_counter[reason] += 1
    for reason, count in reason_counter.most_common():
        add(f"     {reason:<32}: {count}")
    add("   (a word can be excluded for more than one reason, so these overlap)")
    add(f"   new words eligible for pools  : {len(new_eligible)}")
    add(f"   protected current words        : {len(protected)} "
        f"(never excluded, never re-ranked out)")
    protected_problem = [r for r in protected
                         if r.length < args.min_len or r.length > args.max_len
                         or not is_hungarian_letters(r.word)]
    add(f"   protected words that would fail the new-word filters: "
        f"{len(protected_problem)} (kept anyway, by design)")
    if protected_problem:
        add("     " + ", ".join(r.word for r in protected_problem[:20]))
    add("")
    add("4) COMPOUND OBSERVATION (no compounds removed automatically)")
    add(f"   compounds among all candidates: "
        f"{sum(1 for r in records if r.compound)}")
    add(f"   flagged long compounds (>= {args.long_compound_len} chars): "
        f"{sum(1 for r in records if r.compound and r.length >= args.long_compound_len)}")
    add(f"   flagged rare compounds (< {args.rare_frequency:g} frequency): "
        f"{sum(1 for r in records if r.compound and r.matched and (r.effective_frequency() or 0.0) < args.rare_frequency)}")
    add("")
    add("5) PROPOSED POOLS")
    add(f"   {'pool':>7} {'actual':>7} {'new':>7} {'short':>6} "
        f"{'mean len':>9} {'new mean':>9} {'accent%':>8} {'cmpd%':>6} {'unmatched':>10}")
    for info in pool_info:
        add(f"   {info['size']:>7} {info['actual_size']:>7} {info['new_count']:>7} "
            f"{info['shortfall']:>6} {info['mean_length']:>9.2f} "
            f"{info['new_mean_length']:>9.2f} {info['accent_pct']:>8.1f} "
            f"{info['compound_pct']:>6.1f} {info['unmatched']:>10}")
    add("")
    add("   frequency distribution of the members of each pool:")
    add("   (computed over members that have a frequency value; unmatched members")
    add("    are counted at the top of the block)")
    for info in pool_info:
        add(f"     pool {info['size']:>6}: {info['freq_summary']} "
            f"(median {info['freq_median']:.1f}); members without a frequency "
            f"value: {info['unmatched']}")
        add(f"       median word length {info['median_length']:.1f}, "
            f"median length of new words {info['new_median_length']:.1f}")
    add("")
    add("6) ENTROPY FROM THE WORD POOL ONLY")
    add("   (no separator, number or capitalisation entropy is mixed in)")
    add(f"   current production list: 7776 words")
    add("".join(entropy_lines(7776)))
    add("")
    add("   proposed pools:")
    for info in pool_info:
        add("".join(entropy_lines(info["actual_size"])))
    add("")
    add("7) COMPARISON AGAINST THE CURRENT LIST")
    header = (f"   {'pool':>12} {'words':>7} {'bits/word':>10} "
              f"{'3 words':>9} {'4 words':>9} {'5 words':>9} {'avg len':>8}")
    add(header)
    cur_len = (statistics.mean([len(w) for w in current_words])
               if current_words else 0.0)
    bits = math.log2(len(current_words)) if current_words else 0.0
    add(f"   {'current':>12} {len(current_words):>7} {bits:>10.4f} "
        f"{3 * bits:>9.2f} {4 * bits:>9.2f} {5 * bits:>9.2f} {cur_len:>8.2f}")
    for info in pool_info:
        b = info["bits_per_word"]
        add(f"   {('pool ' + str(info['size'])):>12} {info['actual_size']:>7} "
            f"{b:>10.4f} {3 * b:>9.2f} {4 * b:>9.2f} {5 * b:>9.2f} "
            f"{info['mean_length']:>8.2f}")
    add("")
    add("   reading of the table: each extra 1000 words buys a shrinking amount")
    add("   of entropy, while the added words are by construction the rarer and")
    add("   longer ones. The trade-off point is a judgement call, which is why")
    add("   this report proposes several pools instead of one.")
    add("")
    add("8) GENERATED FILES")
    for path, count in written:
        add(f"   {count:>7}  {path}")
    add("")
    add("REMINDER: lang/hun.js and index.html were NOT modified. No pool has")
    add("          been promoted to production; that is a separate decision.")
    report = "\n".join(L) + "\n"
    (out_dir / "stage2_report.txt").write_text(report, encoding="utf-8")

    try:
        sys.stdout.write(report)
    except UnicodeEncodeError:
        sys.stdout.write(report.encode("ascii", "replace").decode("ascii"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
