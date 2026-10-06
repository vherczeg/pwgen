#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze_pools.py - power-of-two pool comparison for the Hungarian passphrase list.

This script does NOT re-rank and does NOT re-read the 615 MB parquet. It consumes
the already-verified Stage-2 output (ranked_candidates.csv, produced by
tools/rank_candidates.py from the Webcorpus 2 frequency table) and derives:

  * exact pools of 16,384 (2^14) and 32,768 (2^15) words,
  * the incremental word sets 7,776 -> 16,384 and 16,384 -> 32,768,
  * human-review samples (random / bottom / tail) for each pool and increment,
  * boundary analysis around both cutoffs (200 words before and after),
  * a frequency-decay table across all pool sizes,
  * the exact word-selection entropy of power-of-two pools,
  * a compact current-vs-16,384-vs-32,768 comparison.

Methodology is unchanged: the same eligible-new-word ordering by corpus lemma
frequency, the same protected 7,776-word base, the same eligibility filters.
Nothing is written to lang/hun.js or index.html.

Usage
-----
    python tools/analyze_pools.py \
        --ranked tools/wordlist_analysis/stage2/ranked_candidates.csv \
        --out-dir tools/wordlist_analysis/stage2_pow2

Reuse in another language
-------------------------
Generic: slicing a ranked list into exact pools, incremental sets, boundary
analysis, sampling, frequency-decay statistics and the word-selection entropy
arithmetic (log2 of the pool size).
Run parameters, not language rules: BASE_SIZE (the pre-migration Hungarian
production size, 7,776) and POW2_POOLS (16,384 / 32,768).
Hungarian-specific: ASCII_ACCENTS and the Hungarian report wording.
For another language: pass that language's ranked CSV and choose pool sizes
that fit its own quality curve - 16,384 = 2^14 was a Hungarian decision after
manual review, not a universal rule.
"""

from __future__ import annotations

import argparse
import csv
import math
import random
import statistics
import sys
from pathlib import Path

SCRIPT_VERSION = "1.0.0"

# Run parameters of the Hungarian migration: the protected production size
# before the migration and the power-of-two pools that were compared.
BASE_SIZE = 7776          # protected words from the pre-migration production list
POW2_POOLS = [16384, 32768]
CHECKPOINTS = [7776, 12000, 16384, 20000, 25000, 32768]
ASCII_ACCENTS = "áéíóöőúüű"   # Hungarian accent set, used for report statistics


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def has_accent(word: str) -> bool:
    return any(ch in ASCII_ACCENTS for ch in word.lower())


def pctl(values: list[float], fraction: float) -> float:
    """Nearest-rank percentile; deterministic and dependency-free."""
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(fraction * (len(ordered) - 1)))))
    return ordered[index]


def freq_stats(words: list[str], freq: dict[str, float | None]) -> dict:
    """Statistics over the added vocabulary of one increment or pool."""
    values = [freq[w] for w in words if freq.get(w) is not None]
    lengths = [len(w) for w in words]
    return {
        "count": len(words),
        "with_freq": len(values),
        "unmatched": len(words) - len(values),
        "min_freq": min(values) if values else None,
        "max_freq": max(values) if values else None,
        "median_freq": statistics.median(values) if values else None,
        "mean_freq": statistics.mean(values) if values else None,
        "mean_len": statistics.mean(lengths) if lengths else 0.0,
        "median_len": statistics.median(lengths) if lengths else 0.0,
        "p90_len": pctl([float(l) for l in lengths], 0.90),
        "compound_pct": 100.0 * sum(1 for w in words if FLAG["compound"][w]) / len(words)
        if words else 0.0,
        "accent_pct": 100.0 * sum(1 for w in words if has_accent(w)) / len(words)
        if words else 0.0,
        "proper_flag": sum(1 for w in words if FLAG["proper"][w]),
        "abbrev_flag": sum(1 for w in words if FLAG["abbrev"][w]),
    }


FLAG: dict[str, dict[str, bool]] = {"compound": {}, "proper": {}, "abbrev": {}}


def st_line(label: str, s: dict) -> str:
    def num(value, digits=0):
        if value is None:
            return "n/a"
        return f"{value:,.{digits}f}"
    return (f"   {label:<22} n={s['count']:>6}  min {num(s['min_freq']):>14}  "
            f"median {num(s['median_freq']):>14}  mean {num(s['mean_freq']):>16}")


# --------------------------------------------------------------------------
# reproducible complexity measures (dictionary + corpus only, no judgement)
# --------------------------------------------------------------------------

VOWELS = set("aáeéiíoóöőuúüű")
DERIV_SUFFIXES = ["ás", "és", "ság", "ség", "zat", "zet", "ék", "ány", "ény",
                  "ista", "izmus", "ikus", "ális", "szerű", "hatatlan",
                  "hetetlen", "ódik", "kedik", "kodik"]
VERB_PREFIXES = ["meg", "el", "be", "ki", "fel", "le", "át", "rá", "ide",
                 "oda", "össze", "szét", "vissza", "alá", "fölé", "bele"]


def complexity(words: list[str], vocabulary: set[str]) -> dict:
    """Mechanical length/pronounceability/composition measures.

    These are computed from the dictionary and the corpus frequencies, never
    from a model's opinion, so they can be reproduced exactly.
    """
    n = len(words)
    if not n:
        return {}
    lengths = [len(w) for w in words]
    syllables = [sum(1 for ch in w if ch in VOWELS) for w in words]

    def splittable(w: str) -> bool:
        return any(w[:i] in vocabulary and w[i:] in vocabulary
                   for i in range(3, len(w) - 2))

    def has_consonant_run(w: str, length: int = 4) -> bool:
        run = 0
        for ch in w.lower():
            if ch in VOWELS:
                run = 0
            else:
                run += 1
                if run >= length:
                    return True
        return False

    return {
        "n": n,
        "mean_len": statistics.mean(lengths),
        "pct_ge10": 100 * sum(1 for l in lengths if l >= 10) / n,
        "pct_ge12": 100 * sum(1 for l in lengths if l >= 12) / n,
        "mean_syl": statistics.mean(syllables),
        "pct_ge5_syl": 100 * sum(1 for s in syllables if s >= 5) / n,
        "pct_compound": 100 * sum(1 for w in words if splittable(w)) / n,
        "pct_suffix": 100 * sum(
            1 for w in words
            if any(w.endswith(s) and len(w) - len(s) >= 3 for s in DERIV_SUFFIXES)) / n,
        "pct_prefix": 100 * sum(
            1 for w in words
            if any(w.startswith(p) and len(w) - len(p) >= 3 for p in VERB_PREFIXES)) / n,
        "pct_consonant_run": 100 * sum(1 for w in words if has_consonant_run(w)) / n,
    }


def cx_line(label: str, m: dict) -> str:
    return (f"   {label:<32} n={m['n']:>6} len {m['mean_len']:.2f} "
            f"| >=10ch {m['pct_ge10']:>4.1f}% >=12ch {m['pct_ge12']:>4.1f}% "
            f"| syl {m['mean_syl']:.2f} >=5syl {m['pct_ge5_syl']:>4.1f}% "
            f"| compound {m['pct_compound']:>4.1f}% suffix {m['pct_suffix']:>4.1f}% "
            f"prefix {m['pct_prefix']:>4.1f}% 4cons {m['pct_consonant_run']:>4.1f}%")


def write_lines(path: Path, values) -> int:
    values = list(values)
    path.write_text("\n".join(values) + ("\n" if values else ""), encoding="utf-8")
    return len(values)


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Power-of-two pool analysis (16,384 / 32,768) over Stage-2 ranking.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument(
        "--ranked", type=Path,
        default=root / "tools" / "wordlist_analysis" / "stage2" / "ranked_candidates.csv")
    parser.add_argument(
        "--out-dir", type=Path,
        default=root / "tools" / "wordlist_analysis" / "stage2_pow2")
    parser.add_argument("--sample-size", type=int, default=500)
    parser.add_argument("--boundary-size", type=int, default=200)
    parser.add_argument("--seed", type=int, default=20240517)
    args = parser.parse_args(argv)

    if not args.ranked.is_file():
        parser.error(f"ranked table not found: {args.ranked}\n"
                     "run tools/rank_candidates.py first.")
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---------------- load the verified ranking ---------------------------
    rows = list(csv.DictReader(args.ranked.open(encoding="utf-8")))
    for row in rows:
        word = row["word"]
        FLAG["compound"][word] = row["compound_flag"] == "1"
        FLAG["proper"][word] = row["proper_name_flag"] == "1"
        FLAG["abbrev"][word] = row["abbreviation_flag"] == "1"

    freq: dict[str, float | None] = {
        r["word"]: (float(r["lemma_freq"]) if r["lemma_freq"] else None) for r in rows}
    length = {r["word"]: int(r["length"]) for r in rows}

    current = [r["word"] for r in rows if r["current"] == "1"]
    # eligible new words, already in frequency-rank order (rank ascending)
    eligible_new = [r["word"] for r in rows
                    if r["current"] == "0" and r["excluded"] == "0"]

    # ---------------- sanity: the protected base ---------------------------
    assert len(current) == BASE_SIZE, (len(current), BASE_SIZE)
    assert len(set(current)) == BASE_SIZE
    for size in POW2_POOLS:
        available = BASE_SIZE + len(eligible_new)
        if available < size:
            raise SystemExit(f"only {available} eligible words available, "
                             f"cannot build a {size}-word pool")

    # ---------------- exact pools -----------------------------------------
    pools: dict[int, list[str]] = {}
    new_by_pool: dict[int, list[str]] = {}
    for size in POW2_POOLS:
        added = eligible_new[: size - BASE_SIZE]
        pools[size] = sorted(set(current) | set(added))
        new_by_pool[size] = added
        assert len(pools[size]) == size, (size, len(pools[size]))
        assert len(set(pools[size])) == size
        assert len(added) == size - BASE_SIZE

    # ---------------- increments ------------------------------------------
    # 7776 -> 16384 and 16384 -> 32768, i.e. each doubling adds exactly the
    # previous pool size in new words (8608 + 16384 = 24992).
    increments: list[tuple[str, str, list[str]]] = []
    increments.append(("increment_7776_to_16384.txt", "7,776 -> 16,384",
                       new_by_pool[16384]))
    increments.append(("increment_16384_to_32768.txt", "16,384 -> 32,768",
                       eligible_new[16384 - BASE_SIZE: 32768 - BASE_SIZE]))

    written: list[tuple[str, int]] = []

    def emit(path: Path, values) -> None:
        written.append((str(path), write_lines(path, values)))

    for size in POW2_POOLS:
        emit(out_dir / f"pool_{size}.txt", pools[size])
        emit(out_dir / f"pool_{size}_new_only.txt", new_by_pool[size])
    for name, _, words in increments:
        emit(out_dir / name, words)

    # ---------------- review sets -----------------------------------------
    rng = random.Random(args.seed)
    samples: dict[str, list[str]] = {}
    for size in POW2_POOLS:
        new = new_by_pool[size]
        n = min(args.sample_size, len(new))

        seed_random = rng.randrange(2 ** 32)
        random_sample = sorted(random.Random(seed_random).sample(new, n))
        samples[f"random_{size}"] = random_sample
        emit(out_dir / f"review_{size}_random{n}.txt", random_sample)

        # lowest-frequency / lowest-ranked additions (the pool's weakest tail)
        bottom = new[-n:] if n else []
        samples[f"bottom_{size}"] = bottom
        emit(out_dir / f"review_{size}_bottom{n}.txt", bottom)

        # sampled from the last 20% of the additions by rank
        tail_start = int(len(new) * 0.8)
        tail_pool = new[tail_start:]
        seed_tail = rng.randrange(2 ** 32)
        tail = sorted(random.Random(seed_tail).sample(tail_pool, min(n, len(tail_pool))))
        samples[f"tail_{size}"] = tail
        emit(out_dir / f"review_{size}_tail{n}.txt", tail)

    # the increment that buys the +1 bit
    inc2 = increments[1][2]
    n = min(args.sample_size, len(inc2))
    seed_random = rng.randrange(2 ** 32)
    inc_random = sorted(random.Random(seed_random).sample(inc2, n))
    emit(out_dir / f"review_increment_16384_to_32768_random{n}.txt", inc_random)
    inc_bottom = inc2[-n:]
    emit(out_dir / f"review_increment_16384_to_32768_bottom{n}.txt", inc_bottom)

    # ---------------- boundary analysis -----------------------------------
    boundaries: dict[int, dict] = {}
    for size in POW2_POOLS:
        added = new_by_pool[size]
        before = added[-args.boundary_size:]
        after_start = size - BASE_SIZE
        after = eligible_new[after_start: after_start + args.boundary_size]
        emit(out_dir / f"boundary_{size}_before{args.boundary_size}.txt", before)
        emit(out_dir / f"boundary_{size}_after{args.boundary_size}.txt", after)
        boundaries[size] = {"before": before, "after": after}

    # ---------------- frequency decay table -------------------------------
    decay: list[dict] = []
    baseline = sorted(current)
    for size in CHECKPOINTS:
        if size == BASE_SIZE:
            added: list[str] = []
        else:
            added = eligible_new[: size - BASE_SIZE]
        length_values = [len(w) for w in (baseline if size == BASE_SIZE else added)]
        freq_values = [freq[w] for w in added if freq.get(w) is not None]
        compound = (sum(1 for w in added if FLAG["compound"][w]) / len(added) * 100
                    if added else 0.0)
        decay.append({
            "size": size,
            "bits": (size.bit_length() - 1) if (size & (size - 1)) == 0
            else math.log2(size),
            "is_pow2": (size & (size - 1)) == 0,
            "new_count": len(added),
            "min_freq": min(freq_values) if freq_values else None,
            "median_freq": statistics.median(freq_values) if freq_values else None,
            "mean_len": statistics.mean(length_values) if length_values else 0.0,
            "compound_pct": compound,
            "eligible_required": len(added),
            "eligible_pool": len(eligible_new),
        })

    # ---------------- report ----------------------------------------------
    L: list[str] = []
    add = L.append
    bar = "=" * 78
    add(bar)
    add("POWER-OF-TWO POOL ANALYSIS - 16,384 (2^14) AND 32,768 (2^15)".center(78))
    add(bar)
    add("word-selection entropy only; no separator/number/capitalisation randomness")
    add("lang/hun.js and index.html were NOT modified; no pool is promoted")
    add("")
    add(f"script version      : {SCRIPT_VERSION}")
    add(f"ranking input       : {args.ranked}")
    add("ranking source      : Peter Racz (2025), Word frequency list from the")
    add("                      Hungarian Webcorpus 2, CC BY 4.0,")
    add("                      doi:10.5281/zenodo.17508385")
    add(f"output directory    : {out_dir}")
    add(f"sample seed         : {args.seed}")
    add("")
    add("1) POOL COMPOSITION VERIFICATION")
    for size in POW2_POOLS:
        add(f"   pool_{size}.txt")
        add(f"     protected current words : {len(current):,}")
        add(f"     new words added         : {len(new_by_pool[size]):,}")
        add(f"     total unique words      : {len(pools[size]):,}")
        add(f"     arithmetic check        : {len(current):,} + "
            f"{len(new_by_pool[size]):,} = {len(current) + len(new_by_pool[size]):,} "
            f"({'OK' if len(pools[size]) == size else 'MISMATCH'})")
    add("")
    add("2) POWER-OF-TWO VERIFICATION AND EXACT ENTROPY")
    for size in POW2_POOLS:
        exponent = size.bit_length() - 1
        add(f"   {size:,} = 2^{exponent} ? {2 ** exponent == size}   "
            f"-> {math.log2(size):.10f} bits/word exactly {exponent} bits")
    add("")
    add("   exact word-selection entropy (bits):")
    add(f"   {'pool':>8} {'per word':>9} {'3 words':>9} {'4 words':>9} "
        f"{'5 words':>9} {'6 words':>9}")
    for size in POW2_POOLS:
        exponent = size.bit_length() - 1
        add(f"   {size:>8,} {exponent:>9} {3 * exponent:>9} {4 * exponent:>9} "
            f"{5 * exponent:>9} {6 * exponent:>9}")
    add("")
    add("3) INCREMENT STATISTICS (the vocabulary each step requires)")
    for name, label, words in increments:
        stats = freq_stats(words, freq)
        add(f"   {name}   [{label}]")
        add(st_line("increment", stats))
        add(f"     mean length {stats['mean_len']:.2f}, median length "
            f"{stats['median_len']:.1f}, p90 length {stats['p90_len']:.1f}")
        add(f"     compound {stats['compound_pct']:.1f}%, accents "
            f"{stats['accent_pct']:.1f}%, proper-name-like flags "
            f"{stats['proper_flag']}, abbreviation-like flags {stats['abbrev_flag']}, "
            f"unmatched-frequency {stats['unmatched']}")
    add("")
    add("4) FREQUENCY DECAY ACROSS POOL SIZES")
    add(f"   {'pool':>8} {'bits/word':>10} {'min added freq':>15} "
        f"{'median added freq':>18} {'mean len':>9} {'compound %':>11} "
        f"{'words required':>15}")
    for row in decay:
        bits = f"{row['bits']:.4f}"
        min_f = f"{row['min_freq']:,.0f}" if row["min_freq"] is not None else "n/a"
        med_f = f"{row['median_freq']:,.0f}" if row["median_freq"] is not None else "n/a"
        label = f"{row['size']:,}" + ("*" if row["is_pow2"] else "")
        add(f"   {label:>8} {bits:>10} {min_f:>15} {med_f:>18} "
            f"{row['mean_len']:>9.2f} {row['compound_pct']:>11.1f} "
            f"{row['new_count']:>15,}")
    add("   (* marks the power-of-two sizes; 7,776 is the protected baseline and")
    add("    its column shows the existing list, not added words)")
    add("   eligible new words available in total: "
        f"{len(eligible_new):,} (pools above can be built up to that size)")
    add("")
    add("5) BOUNDARY ANALYSIS")
    for size in POW2_POOLS:
        before = boundaries[size]["before"]
        after = boundaries[size]["after"]
        sb = freq_stats(before, freq)
        sa = freq_stats(after, freq)
        add(f"   around {size:,} (boundary between rank {size:,} and {size + 1:,})")
        add(st_line("last 200 in pool", sb))
        add(st_line("next 200 out", sa))
        add(f"     frequency range in : {sb['min_freq']:,.0f} .. {sb['max_freq']:,.0f}")
        add(f"     frequency range out: {sa['min_freq']:,.0f} .. {sa['max_freq']:,.0f}")
        add(f"     mean length in/out  : {sb['mean_len']:.2f} / {sa['mean_len']:.2f}, "
            f"median length in/out: {sb['median_len']:.1f} / {sa['median_len']:.1f}")
        if sb["median_freq"] and sa["median_freq"]:
            add(f"     median-frequency ratio in/out: "
                f"{sb['median_freq'] / sa['median_freq']:.3f}")
        if sb["min_freq"] and sa["min_freq"]:
            add(f"     step down across the boundary: "
                f"{sb['min_freq'] - sa['min_freq']:,.0f} occurrences "
                f"({sb['min_freq'] / sa['min_freq']:.3f}x)")
        # is the cutoff near a natural cliff? compare the last step inside the
        # pool with the typical step across the surrounding neighbourhood
        window = freq_stats(eligible_new[size - BASE_SIZE - 200:
                                         size - BASE_SIZE + 200], freq)
        add(f"     400-word neighbourhood around the cutoff: "
            f"{window['min_freq']:,.0f} .. {window['max_freq']:,.0f}")
    add("")
    add("6) COMPARISON: CURRENT vs 16,384 vs 32,768")
    add(f"   {'pool':>8} {'words':>8} {'bits/word':>10} {'3':>4} {'4':>4} {'5':>4} "
        f"{'6':>4} {'mean len':>9} {'med len':>8} {'min added':>12} "
        f"{'med added':>12} {'cmpd%':>7} {'new':>7}")
    cur_mean = statistics.mean([len(w) for w in baseline])
    cur_med = statistics.median([len(w) for w in baseline])
    cur_bits = math.log2(BASE_SIZE)
    cur_stats = freq_stats(baseline, freq)
    add(f"   {'current':>8} {BASE_SIZE:>8,} {cur_bits:>10.4f} "
        f"{3 * cur_bits:>4.1f} {4 * cur_bits:>4.1f} {5 * cur_bits:>4.1f} "
        f"{6 * cur_bits:>4.1f} "
        f"{cur_mean:>9.2f} {cur_med:>8.1f} {'-':>12} {'-':>12} {'-':>7} {0:>7,}")
    for size in POW2_POOLS:
        exponent = size.bit_length() - 1
        stats = freq_stats(pools[size], freq)
        new_stats = freq_stats(new_by_pool[size], freq)
        add(f"   {size:>8,} {size:>8,} {exponent:>10} {3 * exponent:>4} "
            f"{4 * exponent:>4} {5 * exponent:>4} {6 * exponent:>4} "
            f"{stats['mean_len']:>9.2f} {stats['median_len']:>8.1f} "
            f"{new_stats['min_freq']:>12,.0f} {new_stats['median_freq']:>12,.0f} "
            f"{stats['compound_pct']:>7.1f} {len(new_by_pool[size]):>7,}")
    add("")
    add("   The 'min added' and 'med added' columns describe the NEW words only, so")
    add("   they show what quality the expansion buys at each step.")
    add("")
    add("6b) REPRODUCIBLE COMPLEXITY MEASURES (no subjective judgement)")
    add("   Compound = the word decomposes into two dictionary words. Suffix/prefix")
    add("   = matches a written-out derivational suffix / verb prefix list. 4cons =")
    add("   contains a run of 4+ consonants. All are mechanical and repeatable.")
    vocabulary = {r["word"] for r in rows}
    add(cx_line("increment 1 (7,776->16,384)", complexity(increments[0][2], vocabulary)))
    add(cx_line("increment 2 (16,384->32,768)", complexity(increments[1][2], vocabulary)))
    for size in POW2_POOLS:
        add(cx_line(f"pool {size:,} (all members)", complexity(pools[size], vocabulary)))
    for name, label, words in increments:
        tail = words[int(len(words) * 0.8):]
        add(cx_line(f"last 20% of {label}", complexity(tail, vocabulary)))
    add("")
    add("   complexity by corpus-frequency band (all eligible new words):")
    pow_eligible = [r["word"] for r in rows
                    if r["current"] == "0" and r["excluded"] == "0"]
    for lo, hi, name in ((10000, None, ">=10,000"),
                         (3000, 10000, "3,000..10,000"),
                         (1000, 3000, "1,000..3,000"),
                         (0, 1000, "<1,000")):
        band = [w for w in pow_eligible
                if freq.get(w) is not None and freq[w] >= lo
                and (hi is None or freq[w] < hi)]
        if band:
            add(cx_line(f"freq {name}", complexity(band, vocabulary)))
    m1 = complexity(increments[0][2], vocabulary)
    m2 = complexity(increments[1][2], vocabulary)
    add("")
    add("   increment 2 / increment 1 ratios:")
    for key, label in (("mean_len", "mean length"), ("pct_ge10", "share >=10 chars"),
                       ("pct_ge12", "share >=12 chars"), ("mean_syl", "mean syllables"),
                       ("pct_ge5_syl", "share >=5 syllables"),
                       ("pct_compound", "compound rate"),
                       ("pct_consonant_run", "share with 4+ consonant run")):
        ratio = (m2[key] / m1[key]) if m1[key] else float("nan")
        add(f"     {label:<24} {ratio:.2f}x  ({m1[key]:.2f} -> {m2[key]:.2f})")
    add("")
    add("7) THE EXTRA +1 BIT: WHAT IT COSTS")
    step = freq_stats(increments[1][2], freq)
    first = freq_stats(increments[0][2], freq)
    add(f"   Security gain from 16,384 -> 32,768: exactly +1 bit per word")
    add(f"     3-word passphrase: 42 -> 45 bits (+3)")
    add(f"     4-word passphrase: 56 -> 60 bits (+4)")
    add(f"     5-word passphrase: 70 -> 75 bits (+5)")
    add(f"     6-word passphrase: 84 -> 90 bits (+6)")
    add("")
    add(f"   Vocabulary cost:")
    add(f"     first step  7,776 -> 16,384 adds {first['count']:,} words, "
        f"frequency floor {first['min_freq']:,.0f}, median {first['median_freq']:,.0f}, "
        f"mean length {first['mean_len']:.2f}")
    add(f"     second step 16,384 -> 32,768 adds {step['count']:,} words, "
        f"frequency floor {step['min_freq']:,.0f}, median {step['median_freq']:,.0f}, "
        f"mean length {step['mean_len']:.2f}")
    add(f"     ratio of frequency floors (first/second): "
        f"{first['min_freq'] / step['min_freq']:.2f}x")
    add(f"     ratio of medians (first/second): "
        f"{first['median_freq'] / step['median_freq']:.2f}x")
    add(f"     new words added by the second step: {step['count']:,} "
        f"(= the entire 16,384 pool, which is why each doubling doubles the vocabulary)")
    add("")
    add("8) GENERATED FILES")
    for path, count in written:
        add(f"   {count:>7}  {path}")
    add("")
    add("REMINDER: review samples are for human inspection. No word was removed")
    add("          because of a subjective judgement, and corpus frequency was")
    add("          not replaced by any model's opinion.")
    report = "\n".join(L) + "\n"
    (out_dir / "stage2_pow2_report.txt").write_text(report, encoding="utf-8")

    try:
        sys.stdout.write(report)
    except UnicodeEncodeError:
        sys.stdout.write(report.encode("ascii", "replace").decode("ascii"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
