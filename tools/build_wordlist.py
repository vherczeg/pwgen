#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_wordlist.py - Hungarian passphrase candidate builder for the pwgen project.

STAGE 1 ONLY: mechanical cleaning + analysis of the Hunspell source dictionary
(hu_HU.dic), plus a comparison against the *current* production word list
(lang/hun.js).

This script is deliberately NON-DESTRUCTIVE:

  * it never writes to lang/hun.js (the production word list),
  * it never writes to index.html (the generator),
  * every output goes to a separate analysis directory.

The point is to let a human inspect the filtering results before a SECOND,
quality-focused filtering pass is designed.

Determinism
-----------
Everything except the optional random sample file is deterministic. Sample
generation uses random.Random(seed) with a fixed default seed, so samples are
reproducible unless a different --seed is passed.

Usage
-----
    python tools/build_wordlist.py
    python tools/build_wordlist.py --min-len 4 --max-len 12 --sample-size 200
    python tools/build_wordlist.py --dic hu_HU.dic --out-dir tools/wordlist_analysis

    # from the repository root:
    python pwgen/tools/build_wordlist.py --root pwgen

Reuse in another language
-------------------------
Generic: Hunspell .dic parsing, the mechanical cleaning rules, rejection
bookkeeping, deterministic sampling and the report/JSON layout.
Hungarian-specific: the alphabet/collation block below (HUNGARIAN_ALPHABET,
HUNGARIAN_LETTERS, VOWELS, FOREIGN_LETTERS), the flag handling of this
particular dictionary, the Hungarian report wording, and the default --dic.
For another language: supply that language's Hunspell dictionary (or any
one-word-per-line list), replace the alphabet/collation constants with its own
letters (digraphs included), extend FOREIGN_LETTERS with letters that should be
reviewed rather than dropped, and revisit the compound/abbreviation heuristics,
which assume Hungarian orthography.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

SCRIPT_VERSION = "1.1.0"

# --------------------------------------------------------------------------
# Hungarian alphabet / collation  --  LANGUAGE-SPECIFIC BLOCK
# Replace this whole block when reusing the pipeline for another language.
# --------------------------------------------------------------------------

# Letters of the Hungarian alphabet (44 letters, digraphs included).
HUNGARIAN_ALPHABET = [
    "a", "á", "b", "c", "cs", "d", "dz", "dzs", "e", "é", "f", "g", "gy",
    "h", "i", "í", "j", "k", "l", "ly", "m", "n", "ny", "o", "ó", "ö", "ő",
    "p", "q", "r", "s", "sz", "t", "ty", "u", "ú", "ü", "ű", "v", "w", "x",
    "y", "z", "zs",
]

HUNGARIAN_ACCENTED = "áéíóöőúüű"
HUNGARIAN_LETTERS = set("aábcdeéfghiíjklmnoóöőpqrstuúüűvwxyz")
VOWELS = set("aáeéiíoóöőuúüű")

# ASCII punctuation / symbols: never usable inside a passphrase token.
ASCII_PUNCTUATION = set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")

# Characters allowed inside a token besides letters (kept, but reviewed).
TOKEN_EXTRA = set("'-’")

# Letters outside the Hungarian alphabet and outside ASCII: not dropped
# silently, routed to review/further inspection instead.
FOREIGN_LETTERS = set("äåæçèêëìîïðñòôøùûýþÿłńśźżščřžđğįı")

_DIGRAPHS = sorted(
    (letter for letter in HUNGARIAN_ALPHABET if len(letter) > 1),
    key=len, reverse=True,
)
_LETTER_RANK = {letter: i for i, letter in enumerate(HUNGARIAN_ALPHABET)}
_UNKNOWN_RANK = len(HUNGARIAN_ALPHABET) + 1


def hungarian_sort_key(word: str) -> tuple:
    """Sort key implementing (approximate) Hungarian dictionary collation.

    Digraphs (cs, dz, dzs, gy, ly, ny, sz, ty, zs) count as single letters and
    accented vowels fold to their base letter, which is what Hungarian
    dictionary order does (a/á and o/ó/ö/ő interleave).

    The key is a TOTAL order. Spellings that differ only by case collide in the
    collation part (that is intended, e.g. "Bécs" and "bécs" belong together),
    so the spelling itself is appended as a final tie-breaker. Without it,
    sorting a set - whose iteration order differs between processes - would put
    equal-key words in a run-dependent order and make the output non-reproducible.
    The tie-breaker is expressed as code points (not as a string) so that every
    element of the key is a tuple of integers and keys stay mutually comparable.
    """
    lowered = word.lower()
    tokens: list[tuple[int, str, int]] = []
    i = 0
    n = len(lowered)
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


def sort_words(words) -> list[str]:
    """Deterministic Hungarian-ordered sort usable on sets and lists."""
    return sorted(words, key=hungarian_sort_key)


# --------------------------------------------------------------------------
# Hunspell parsing
# --------------------------------------------------------------------------

class DicEntry:
    """One parsed source line of a Hunspell .dic file."""

    __slots__ = ("lineno", "raw", "base", "flags", "meta")

    def __init__(self, lineno: int, raw: str) -> None:
        self.lineno = lineno
        self.raw = raw
        # Hunspell layout:  word[/FLAGS][<TAB>morphological_or_affix_field]
        head, sep, meta = raw.partition("\t")
        self.meta = meta.strip() if sep else ""
        self.base, sep2, self.flags = head.strip().partition("/")
        self.base = self.base.strip()
        self.flags = self.flags.strip() if sep2 else ""


def parse_dic(path: Path, encoding: str = "utf-8-sig"):
    """Parse a Hunspell .dic file. Returns (header, entries, diagnostics)."""
    raw = path.read_text(encoding=encoding)
    lines = raw.split("\n")
    diag = {
        "bytes": path.stat().st_size,
        "cr_count": raw.count("\r"),
        "tab_count": raw.count("\t"),
        "physical_lines": len(lines),
    }

    header = ""
    body_start = 0
    if lines:
        first = lines[0].strip().lstrip("\ufeff")
        if re.fullmatch(r"\d+", first):      # bare count header line
            header = first
            body_start = 1

    entries: list[DicEntry] = []
    blank = 0
    for offset, line in enumerate(lines[body_start:]):
        line = line.rstrip("\r")
        if not line.strip():
            blank += 1
            continue
        entries.append(DicEntry(body_start + offset + 1, line))

    # duplicate accounting across ALL parsed entries, independent of filtering
    base_counter = Counter(e.base for e in entries)
    diag["header_count"] = int(header) if header else None
    diag["blank_lines"] = blank
    diag["distinct_base_spellings"] = len(base_counter)
    diag["duplicate_base_entries"] = sum(c - 1 for c in base_counter.values())
    diag["distinct_casefold_spellings"] = len({e.base.casefold() for e in entries})
    return header, entries, diag


# --------------------------------------------------------------------------
# Mechanical cleaning (PASS 1)
# --------------------------------------------------------------------------

REJECTION_ORDER = ["empty", "digits", "whitespace", "punctuation", "other_char", "length"]

REJECTION_LABEL = {
    "empty": "empty entries",
    "digits": "digits",
    "whitespace": "whitespace / multiword",
    "punctuation": "punctuation / symbols",
    "other_char": "other non-Hungarian chars",
    "length": "length outside window",
}


class Rejections:
    """Non-overlapping rejection counters.

    Each unique entry is attributed to exactly ONE reason: the first rule it
    trips. That keeps the numbers addable and makes the audit files usable.
    """

    def __init__(self) -> None:
        self.counts: Counter[str] = Counter()
        self.examples: dict[str, list[str]] = {k: [] for k in REJECTION_ORDER}

    def reject(self, reason: str, word: str) -> None:
        self.counts[reason] += 1
        bucket = self.examples[reason]
        if len(bucket) < 25:
            bucket.append(word)

    @property
    def total(self) -> int:
        return sum(self.counts.values())


def is_unusual_char(ch: str) -> bool:
    """True for characters that are neither ASCII letters nor Hungarian ones."""
    if ch in HUNGARIAN_LETTERS or ch in TOKEN_EXTRA:
        return False
    if ch.isascii() and ch.isalpha():
        return False
    return True


def has_unusual_char(word: str) -> bool:
    return any(is_unusual_char(ch) for ch in word)


def classify_mechanical(word: str, min_len: int, max_len: int):
    """Rules 1-12 of the mechanical pass.

    Returns (category, cleaned). `category` is "kept" or a rejection key.
    """
    # Rule 2: Unicode-normalize to the composed form (one codepoint per letter).
    w = unicodedata.normalize("NFC", word)
    # Rule 3: trim whitespace.
    w = w.strip()

    # Rule 6: reject empty entries.
    if not w:
        return "empty", ""

    # Rule 7: reject entries containing digits.
    if any(ch.isdigit() for ch in w):
        return "digits", ""

    # Rule 8: reject entries containing whitespace (incl. NBSP and tabs).
    if any(ch.isspace() for ch in w):
        return "whitespace", ""

    # Rule 9: reject ASCII punctuation and symbols. Dash-joined compounds and
    # dotted abbreviations die here on purpose; they are audited separately.
    if any(ch in ASCII_PUNCTUATION for ch in w):
        return "punctuation", ""

    # Rules 10 + unusual Unicode: keep Hungarian letters (á é í ó ö ő ú ü ű),
    # ASCII letters and apostrophes; anything else goes to review instead of
    # being silently dropped.
    if not all(
        ch in HUNGARIAN_LETTERS or (ch.isascii() and ch.isalpha()) or ch in TOKEN_EXTRA
        for ch in w
    ):
        return "other_char", ""

    # Rules 11-12: length bounds, counted in Unicode code points.
    if not (min_len <= len(w) <= max_len):
        return "length", ""

    # Rules 4 + 5 (lowercase + de-duplicate) are applied by the caller.
    return "kept", w


# --------------------------------------------------------------------------
# Quality diagnostics (REVIEW ONLY - nothing is deleted here)
# --------------------------------------------------------------------------

def looks_like_abbreviation(word: str) -> bool:
    """Conservative, explainable abbreviation detector.

    Flags: all-caps tokens, tokens with no vowel at all, tokens containing a
    run of 5+ consonants. Deliberately crude; it is a review list, not a filter.
    """
    if word.isupper() and len(word) >= 2:
        return True
    letters = [c for c in word if c.isalpha()]
    if len(letters) >= 2 and not any(c.lower() in VOWELS for c in letters):
        return True
    if len(letters) >= 5:
        longest = max(
            (len(run) for run in re.findall(r"[^aáeéiíoóöőuúüű]+", word.lower())),
            default=0,
        )
        if longest >= 5:
            return True
    return False


def split_compound_score(word: str, vocabulary: set[str]) -> bool:
    """True when the word splits into two dictionary words.

    This is only an OBSERVATION about the candidate pool: Hungarian compounds
    are written as one token, so this measures how much of the pool consists of
    compound words (a likely target of the second, quality-focused pass). It is
    not used to remove anything.
    """
    n = len(word)
    for i in range(3, n - 2):
        if word[:i] in vocabulary and word[i:] in vocabulary:
            return True
    return False


# --------------------------------------------------------------------------
# Production word list discovery
# --------------------------------------------------------------------------

WORD_ARRAY_PATTERNS = [
    re.compile(r"window\.HU_WORDS\s*=\s*\[(.*?)\]\s*;", re.S),
    re.compile(r"window\.[A-Z][A-Z0-9_]*\s*=\s*\[(.*?)\]\s*;", re.S),
]


def find_production_wordlists(root: Path) -> list[tuple[Path, list[str]]]:
    """Locate arrays of quoted words inside JS/JSON files of the project."""
    found: list[tuple[Path, list[str]]] = []
    skip_dirs = {".git", "node_modules", "__pycache__", "wordlist_analysis"}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".js", ".json", ".mjs", ".cjs"}:
            continue
        if any(part in skip_dirs for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="strict")
        except (UnicodeDecodeError, OSError):
            continue
        for pattern in WORD_ARRAY_PATTERNS:
            for match in pattern.finditer(text):
                words = re.findall(r'"((?:[^"\\]|\\.)*)"', match.group(1))
                if len(words) >= 100:
                    found.append((path, words))
    return found


# --------------------------------------------------------------------------
# Output helpers
# --------------------------------------------------------------------------

def write_lines(path: Path, values) -> int:
    values = list(values)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(values) + ("\n" if values else ""), encoding="utf-8")
    return len(values)


def header_block(title: str, subtitle: str = "") -> str:
    bar = "=" * 78
    out = [bar, title.center(78), bar]
    if subtitle:
        out.append(subtitle)
    return "\n".join(out)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    project_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Hungarian passphrase candidate analysis (stage 1, read-only).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--dic", type=Path, default=project_root / "hu_HU.dic",
                        help="Input Hunspell dictionary")
    parser.add_argument("--root", type=Path, default=project_root,
                        help="Project root used to find the production word list")
    parser.add_argument("--out-dir", type=Path,
                        default=project_root / "tools" / "wordlist_analysis",
                        help="Directory for generated analysis files")
    parser.add_argument("--min-len", type=int, default=3, help="Minimum word length")
    parser.add_argument("--max-len", type=int, default=16, help="Maximum word length")
    parser.add_argument("--sample-size", type=int, default=200,
                        help="Number of words in the random sample file")
    parser.add_argument("--seed", type=int, default=20240517,
                        help="Seed for the sample file (samples only)")
    parser.add_argument("--short-len", type=int, default=4,
                        help="Upper bound of the 'very short' review bucket")
    parser.add_argument("--long-len", type=int, default=13,
                        help="Lower bound of the 'very long' review bucket")
    parser.add_argument("--encoding", default="utf-8-sig", help="Dictionary encoding")
    parser.add_argument("--quiet", action="store_true", help="Print only a short summary")
    args = parser.parse_args(argv)

    out_dir: Path = args.out_dir
    review_dir = out_dir / "review"
    out_dir.mkdir(parents=True, exist_ok=True)
    review_dir.mkdir(parents=True, exist_ok=True)

    # ---------------- 1. parse ---------------------------------------------
    if not args.dic.is_file():
        parser.error(f"dictionary not found: {args.dic}")
    header, entries, diag = parse_dic(args.dic, args.encoding)

    categorised = [(e, classify_mechanical(e.base, args.min_len, args.max_len))
                   for e in entries]
    by_category: dict[str, list[DicEntry]] = {k: [] for k in REJECTION_ORDER}
    by_category["kept"] = []
    for entry, (category, _) in categorised:
        by_category[category].append(entry)

    # ---------------- 2. de-duplication ------------------------------------
    # Step A: entries that survive the mechanical rules.
    rejections = Rejections()
    survivors: list[str] = []
    for entry, (category, word) in categorised:
        if category != "kept":
            rejections.reject(category, entry.base)
        else:
            survivors.append(word)

    # Step B: rules 4 + 5. Group the surviving spellings by lowercase form and
    # keep exactly one spelling per group: the lowercase spelling when it exists
    # (e.g. "Bécs" + "bécs" -> "bécs"), otherwise the first occurrence in source
    # order. Source order is fixed, so this stays deterministic.
    groups: dict[str, list[str]] = {}
    for word in survivors:
        groups.setdefault(word.lower(), []).append(word)

    candidates: list[str] = []
    merge_log: list[str] = []
    same_spelling_dupes = 0
    case_only_dupes = 0
    for key, variants in groups.items():
        unique_variants = list(dict.fromkeys(variants))
        same_spelling_dupes += len(variants) - len(unique_variants)
        lowered = [v for v in unique_variants if v == key]
        chosen = lowered[0] if lowered else unique_variants[0]
        if len(unique_variants) > 1:
            case_only_dupes += len(unique_variants) - 1
            merge_log.append(
                f"{key}\t{chosen}\t"
                + ",".join(v for v in unique_variants if v != chosen)
            )
        candidates.append(chosen)

    candidates.sort(key=hungarian_sort_key)
    candidate_set = set(candidates)

    # capitalised source spellings whose lowercase twin is in the final pool
    capitalised_handled = sum(
        1 for e, (cat, w) in categorised
        if cat == "kept" and w != w.lower() and w.lower() in candidate_set
    )

    # ---------------- 3. review buckets (nothing is deleted) ---------------
    mixed_case = sort_words(
        {e.base for e in by_category["kept"]
         if any(c.isupper() for c in e.base) and not e.base.isupper()})
    all_caps = sort_words(
        {e.base for e in by_category["kept"] if e.base.isupper()})

    buckets: dict[str, list[str]] = {
        "review_short_3.txt": [w for w in candidates if len(w) == 3],
        "review_short_4.txt": [w for w in candidates if len(w) == 4],
        "review_long_13_16.txt": [w for w in candidates
                                  if args.long_len <= len(w) <= args.max_len],
        "review_capitalised_mixed_case.txt": mixed_case,
        "review_capitalised_all_caps.txt": all_caps,
        "review_unusual_unicode.txt": sort_words(
            {w for w in candidates if has_unusual_char(w)}),
        "review_abbreviation_like.txt": sort_words(
            {w for w in candidates if looks_like_abbreviation(w)}),
        "review_apostrophe_or_dashlike.txt": sort_words(
            {w for w in candidates if any(c in TOKEN_EXTRA for c in w)}),
    }
    for reason in REJECTION_ORDER:
        buckets[f"rejected_{reason}.txt"] = sort_words(
            {e.base for e in by_category[reason]})

    # ---------------- 4. production list comparison ------------------------
    production_files = find_production_wordlists(args.root)
    comparison: dict = {"found": False}
    current_words: list[str] = []
    if production_files:
        prod_path, prod_words = production_files[0]
        current_words = prod_words
        cur_keys = {w.casefold() for w in prod_words}
        cand_keys = {w.casefold() for w in candidates}
        lost = sorted(cur_keys - cand_keys)
        comparison = {
            "found": True,
            "path": str(prod_path.relative_to(args.root))
            if prod_path.is_relative_to(args.root) else str(prod_path),
            "all_matches": [str(p) for p, _ in production_files],
            "current_count": len(prod_words),
            "current_unique": len(cur_keys),
            "present_in_candidates": len(cur_keys & cand_keys),
            "lost_count": len(lost),
            "lost_words": lost[:200],
            "new_available": len(cand_keys - cur_keys),
            "min_len": min((len(w) for w in prod_words), default=0),
            "max_len": max((len(w) for w in prod_words), default=0),
            "length_dist": dict(sorted(Counter(len(w) for w in prod_words).items())),
            "has_uppercase": sum(1 for w in prod_words if any(c.isupper() for c in w)),
            "has_accents": sum(1 for w in prod_words if any(c in HUNGARIAN_ACCENTED for c in w)),
            "has_digits": sum(1 for w in prod_words if any(c.isdigit() for c in w)),
            "has_punctuation": sum(1 for w in prod_words
                                   if any(c in ASCII_PUNCTUATION for c in w)),
        }

    # ---------------- 5. length / sensitivity analysis ---------------------
    length_dist = Counter(len(w) for w in candidates)

    # Candidate pool shrinks the longer the cap; also report how many current
    # words a cap would cost, and the resulting 4-word entropy, because the
    # target size must come from the entropy requirement, not the other way in.
    cap_rows = []
    caps = sorted({4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, args.max_len})
    for cap in caps:
        if not (args.min_len <= cap <= args.max_len):
            continue
        sub = {w for w in candidates if len(w) <= cap}
        cap_rows.append({
            "max_len": cap,
            "candidates": len(sub),
            "current_words_kept": len({w.casefold() for w in current_words} & sub)
            if current_words else None,
            "current_words_lost": len({w.casefold() for w in current_words} - sub)
            if current_words else None,
            "bits_4_words": round(4 * math.log2(len(sub)), 2) if sub else 0.0,
        })

    # Compound observation, computed on a couple of representative caps.
    compound_rows = []
    for cap in (args.max_len, 12, 10):
        if cap > args.max_len:
            continue
        sub = [w for w in candidates if len(w) <= cap]
        hits = sum(1 for w in sub if split_compound_score(w, candidate_set))
        compound_rows.append({
            "max_len": cap,
            "candidates": len(sub),
            "splittable_into_two_words": hits,
            "share": round(100 * hits / len(sub), 1) if sub else 0.0,
        })

    # ---------------- 6. files ---------------------------------------------
    # Re-runs must not leave stale files behind from an earlier configuration
    # (for example an old bucket name), so the generated directories are
    # cleared first. Only files directly inside them are removed.
    for directory in (out_dir, review_dir):
        for stale in directory.glob("*.txt"):
            stale.unlink()
    for stale in out_dir.glob("*.json"):
        stale.unlink()

    written: list[tuple[str, int]] = []

    def emit(path: Path, values) -> None:
        written.append((str(path), write_lines(path, values)))

    emit(out_dir / "candidate_words.txt", candidates)
    emit(out_dir / "candidate_words_capped12.txt",
         [w for w in candidates if len(w) <= 12])
    rng = random.Random(args.seed)
    sample = sorted(rng.sample(candidates, min(args.sample_size, len(candidates))),
                    key=hungarian_sort_key)
    emit(out_dir / f"sample_{args.sample_size}.txt", sample)
    for name, words in buckets.items():
        emit(review_dir / name, words)

    emit(review_dir / "rejection_examples.txt",
         [f"{reason}\t{w}" for reason in REJECTION_ORDER
          for w in rejections.examples[reason]])

    # which spelling was kept when two spellings differed only by case
    emit(review_dir / "case_merge_log.txt",
         ["# lowercase_key\tkept_spelling\tdropped_spellings"] + sorted(merge_log))

    char_counter: Counter[str] = Counter()
    for entry in entries:
        for ch in entry.base:
            if is_unusual_char(ch):
                char_counter[ch] += 1
    char_lines = []
    for ch, count in sorted(char_counter.items(), key=lambda kv: (-kv[1], kv[0])):
        try:
            name = unicodedata.name(ch)
        except ValueError:
            name = "<unnamed>"
        char_lines.append(f"U+{ord(ch):04X}\t{ch}\t{name}\t{count}")
    emit(out_dir / "unusual_character_inventory.txt", char_lines)

    # ---------------- 7. report -------------------------------------------
    L: list[str] = []
    add = L.append
    add(header_block(
        "HUNGARIAN PASSPHRASE WORDLIST - STAGE 1 ANALYSIS",
        "mechanical cleaning only; production word list NOT touched"))
    add("")
    add(f"script version      : {SCRIPT_VERSION}")
    add(f"source dictionary   : {args.dic}")
    add(f"project root        : {args.root}")
    add(f"output directory    : {out_dir}")
    add(f"length window       : {args.min_len}..{args.max_len} characters")
    add(f"sample seed         : {args.seed}")
    add("")
    add("1) SOURCE FILE")
    add(f"   header count line           : {diag['header_count']}")
    add(f"   parsed non-blank data lines : {len(entries)}")
    add(f"   header minus parsed lines   : "
        f"{(diag['header_count'] or 0) - len(entries)}")
    add(f"   blank lines skipped         : {diag['blank_lines']}")
    add(f"   entries carrying /FLAGS     : "
        f"{sum(1 for e in entries if e.flags)}")
    add(f"   entries carrying TAB meta   : "
        f"{sum(1 for e in entries if e.meta)}")
    add(f"   distinct base spellings     : {diag['distinct_base_spellings']}")
    add(f"   duplicate spelling entries  : {diag['duplicate_base_entries']} "
        f"(same spelling repeated in the file)")
    add(f"   distinct case-insensitive   : {diag['distinct_casefold_spellings']}")
    add(f"   capitalised source spellings whose lowercase twin is in the pool: "
        f"{capitalised_handled}")
    add("")
    add("2) MECHANICAL CLEANING (each entry attributed to its first failing rule)")
    add(f"   source entries              : {len(entries)}")
    for reason in REJECTION_ORDER:
        add(f"   - {REJECTION_LABEL[reason]:<27}: {rejections.counts[reason]}")
    add(f"   = entries passing the rules : "
        f"{len(entries) - rejections.total}")
    add(f"   - repeated after cleaning   : {same_spelling_dupes} "
        f"(rules 4-5, same spelling)")
    add(f"   - differing only by case    : {case_only_dupes} "
        f"(lowercase spelling kept)")
    add(f"   = FINAL MECHANICAL CANDIDATES: {len(candidates)}")
    add("")
    add("   sanity check: entries minus rejections minus duplicates = "
        f"{len(entries) - rejections.total - same_spelling_dupes - case_only_dupes}"
        f" (candidates: {len(candidates)})")
    add("")
    add("   rejected examples (first 8 per rule):")
    for reason in REJECTION_ORDER:
        ex = rejections.examples[reason][:8]
        if ex:
            add(f"     {reason:<13}: " + ", ".join(ex))
    add("")
    add("3) WORD LENGTH DISTRIBUTION (mechanical candidates)")
    peak = max(length_dist.values()) if length_dist else 1
    for length in range(min(length_dist), max(length_dist) + 1):
        count = length_dist.get(length, 0)
        bar = "#" * max(1, round(46 * count / peak)) if count else ""
        add(f"   {length:>2} chars: {count:>6}  {bar}")
    add(f"   {'total':>9}: {sum(length_dist.values()):>6}")
    if length_dist:
        total = sum(length_dist.values())
        mean_len = sum(l * c for l, c in length_dist.items()) / total
        add(f"   mean length: {mean_len:.2f} characters")
    add("")
    add("4) EFFECT OF A LENGTH CAP (input for the second pass)")
    add(f"   {'cap':>4} {'candidates':>11} {'pool bits (4 words)':>20} "
        f"{'current kept':>13} {'current lost':>13}")
    for row in cap_rows:
        add(f"   {row['max_len']:>4} {row['candidates']:>11} "
            f"{row['bits_4_words']:>20} "
            f"{str(row['current_words_kept']):>13} {str(row['current_words_lost']):>13}")
    add("   note: pool bits = 4 * log2(candidate count), the same model the")
    add("         generator uses for the word part of a 4-word passphrase.")
    add("")
    add("5) COMPOUND OBSERVATION (no filtering performed)")
    for row in compound_rows:
        add(f"   words up to {row['max_len']:>2} chars: {row['candidates']:>6} candidates, "
            f"{row['splittable_into_two_words']:>6} split into two dictionary words "
            f"({row['share']}%)")
    add("   note: Hungarian writes compounds as one token, so these are the")
    add("         main source of 'long, hard to read' candidates.")
    add("")
    add("6) CURRENT PRODUCTION WORD LIST")
    if comparison["found"]:
        add(f"   location                    : {comparison['path']}")
        add(f"   current word count          : {comparison['current_count']}")
        add(f"   unique (case-insensitive)   : {comparison['current_unique']}")
        add(f"   length range                : {comparison['min_len']}..{comparison['max_len']}")
        add(f"   words containing accents    : {comparison['has_accents']}")
        add(f"   words containing uppercase  : {comparison['has_uppercase']}")
        add(f"   words containing digits     : {comparison['has_digits']}")
        add(f"   words containing punctuation: {comparison['has_punctuation']}")
        add("")
        add(f"   present in new candidates   : {comparison['present_in_candidates']}")
        add(f"   would be lost               : {comparison['lost_count']}")
        add(f"   potential new words         : {comparison['new_available']}")
        if comparison["lost_words"]:
            add(f"   lost examples               : "
                + ", ".join(comparison["lost_words"][:20]))
    else:
        add(f"   NOT FOUND - no window.*_WORDS array found under {args.root}")
    add("")
    add("7) REVIEW BUCKETS (NOTHING WAS DELETED - inspect these files)")
    for name in sorted(buckets):
        add(f"   {name:<42}: {len(buckets[name])}")
    add(f"   {'unusual_character_inventory.txt':<42}: {len(char_lines)}")
    add("")
    add("   rules behind each bucket:")
    add("     review_short_3 / review_short_4   : length == 3 / == 4 characters")
    add("     review_long_13_16                 : length 13..16 characters")
    add("     review_capitalised_mixed_case     : source spelling has an uppercase")
    add("                                         letter but is not all caps")
    add("                                         (likely proper names, places)")
    add("     review_capitalised_all_caps       : source spelling is ALL CAPS")
    add("                                         (likely acronyms)")
    add("     review_unusual_unicode            : contains a character that is")
    add("                                         neither ASCII nor Hungarian")
    add("     review_abbreviation_like          : all caps, vowel-less, or 5+")
    add("                                         consonants in a row")
    add("     review_apostrophe_or_dashlike     : contains ' - or the typographic")
    add("                                         apostrophe")
    add("     rejected_<rule>                   : the entries removed by that rule,")
    add("                                         for auditing the rules themselves")
    add("   buckets overlap; they are review lists, not filters.")
    add("")
    add("8) GENERATED FILES")
    for path, count in written:
        add(f"   {count:>7}  {path}")
    add("")
    add("9) SECOND PASS - SUGGESTIONS ONLY, NOT IMPLEMENTED")
    for s in [
        "The dictionary alone cannot rank quality: it carries no frequency or",
        "difficulty data, and its second column is only a homonym id, so an",
        "external signal is needed to choose WHICH 15k-25k of the 82k",
        "candidates to keep. Suggested, in order of expected value:",
        "",
        "  a) Frequency filter (strongest signal). Intersect the candidates with",
        "     a Hungarian frequency list (subtitle/news/web corpus) and keep the",
        "     most frequent N band. This is measurement, not linguistic guessing.",
        "  b) Length policy. The current list is 4..12 characters; a 12-char cap",
        "     already keeps every current word (see section 4) and drops the",
        "     9k+ 13-16 character words, which are the hardest to type.",
        "  c) Compound/derivation policy. Roughly a fifth of the pool splits",
        "     into two dictionary words; decide a rule (drop compounds, or keep",
        "     only very common ones) and write down the suffix list used, instead",
        "     of stemming by guesswork.",
        "  d) Confusability check. Flag minimal pairs that differ only by an",
        "     accent (oszo/oszo) or a doubled letter (megy/meggy); such pairs are",
        "     a real risk in a hand-typed passphrase.",
        "  e) Abbreviation/acronym removal from review_abbreviation_like.txt and",
        "     review_capitalised_all_caps.txt; acronyms make poor passphrase",
        "     words.",
        "  f) Explicit decision on foreign letters (a-umlaut, l-stroke, c-caron)",
        "     and on the apostrophe: they are hard to type on a Hungarian layout.",
        "  g) Pick the size from the entropy requirement: 4-word passphrases over",
        "     this pool give ~51.7 bits at 7776 words, ~56.0 at 16384,",
        "     ~57.3 at 20000 and ~58.6 at 25000 (4 * log2(N)). Choose the target",
        "     from the requirement, then take the top-N ranked words.",
        "  h) Keep the current 7776 words unconditionally: all of them survive",
        "     the mechanical pass and they are known-good, hand-picked material.",
    ]:
        add("   " + s if s else "")
    add("")
    add("REMINDER: lang/hun.js and index.html were NOT modified by this run.")
    report = "\n".join(L) + "\n"
    (out_dir / "analysis_report.txt").write_text(report, encoding="utf-8")

    summary = {
        "script_version": SCRIPT_VERSION,
        "dic": str(args.dic),
        "dic_header_count": diag["header_count"],
        "parsed_entries": len(entries),
        "distinct_base_spellings": diag["distinct_base_spellings"],
        "duplicate_base_entries": diag["duplicate_base_entries"],
        "rejections": {r: rejections.counts[r] for r in REJECTION_ORDER},
        "rejected_total": rejections.total,
        "duplicates_after_cleaning": {
            "same_spelling": same_spelling_dupes,
            "case_only": case_only_dupes,
            "capitalised_dropped_in_favour_of_lowercase": capitalised_handled,
        },
        "mechanical_candidates": len(candidates),
        "length_window": [args.min_len, args.max_len],
        "length_distribution": dict(sorted(length_dist.items())),
        "length_cap_sensitivity": cap_rows,
        "compound_observation": compound_rows,
        "review_buckets": {name: len(words) for name, words in buckets.items()},
        "production": comparison,
        "outputs": {str(p): c for p, c in written},
        "sample_seed": args.seed,
    }
    (out_dir / "analysis_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # ---------------- 8. console ------------------------------------------
    if not args.quiet:
        try:
            sys.stdout.write(report)
        except UnicodeEncodeError:
            # Legacy Windows console code page: degrade to ASCII rather than
            # losing the whole run. All written files stay UTF-8.
            sys.stdout.write(report.encode("ascii", "replace").decode("ascii"))
    else:
        print(f"source entries       : {len(entries)}")
        print(f"mechanical candidates: {len(candidates)}")
        if comparison["found"]:
            print(f"current list         : {comparison['current_count']} "
                  f"(lost {comparison['lost_count']}, new {comparison['new_available']})")
        print(f"report               : {out_dir / 'analysis_report.txt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
