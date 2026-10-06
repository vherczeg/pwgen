#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_frequency_table.py - turn the Webcorpus 2 frequency parquet into the
compact TSV that tools/rank_candidates.py consumes.

Source dataset
--------------
Peter Racz, "Word frequency list from the Hungarian Webcorpus 2",
https://doi.org/10.5281/zenodo.17508385 (CC BY 4.0)
Code: https://github.com/petyaracz/Webcorpus2FrequencyList (tag v1.0)
File: frequencies.parquet (615,574,095 bytes, 36,936,726 rows)

The parquet columns are: form, lemma, xpostag, freq, corpus_size, lemma_freq,
lfpm10, llfpm10, form_length, form_syl_count, lemma_length, lemma_syl_count,
hunspell.

Why a converter
---------------
Reading parquet needs pyarrow/polars/duckdb, but the ranking step itself should
stay pure standard library. So this script is the only place that touches
parquet, and it writes a TSV that rank_candidates.py can parse anywhere.

What it produces
----------------
One row per candidate spelling, keyed on the exact normalized word, with the
same column names as the source table:

  form       the attested form (empty when the candidate was matched as a lemma)
  lemma      the lemma the source row belongs to
  lemma_freq raw lemma frequency
  llfpm10    log10 lemma frequency per million
  freq       raw form frequency, summed over the form's part-of-speech readings
  lfpm10     log10 form frequency per million
  form_length / lemma_length / hunspell   copied from the source row

A spelling that qualifies both as an attested form and as a lemma of other
forms is emitted once, as a form row, so no key is ever duplicated and no two
different measures are merged.

Only candidates present in the Stage-1 pool are written, so the TSV stays small
even though the source has 36.9M rows.

Usage
-----
    python tools/extract_frequency_table.py \
        --parquet tools/_webcorpus2_frequencies.parquet \
        --out tools/wordlist_analysis/stage2/frequency_webcorpus2.tsv

Reuse in another language
-------------------------
Generic: the parquet -> compact TSV conversion (column selection, per-key
aggregation, deterministic ordering) and the split that keeps every other
script on the standard library only.
Language-specific: nothing in the code itself - the language enters through the
dataset and the candidate list. For another language: point --parquet at that
language's frequency dataset, adjust --columns when its schema differs, and
keep the output column names compatible with tools/rank_candidates.py (or use
its --*-col options). The candidates it filters against come from
tools/build_wordlist.py.
"""

from __future__ import annotations

import argparse
import sys
import unicodedata
from pathlib import Path

COLUMNS = ["form", "lemma", "freq", "lemma_freq", "lfpm10", "llfpm10",
           "form_length", "lemma_length", "hunspell"]


def normalize_key(text: str) -> str:
    return unicodedata.normalize("NFC", text).strip().lower()


def main(argv=None) -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Reduce the Webcorpus 2 frequency parquet to a candidate TSV.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--parquet", type=Path, required=True)
    parser.add_argument(
        "--candidates", type=Path,
        default=root / "tools" / "wordlist_analysis" / "candidate_words.txt")
    parser.add_argument(
        "--out", type=Path,
        default=root / "tools" / "wordlist_analysis" / "stage2" /
                "frequency_webcorpus2.tsv")
    parser.add_argument("--batch-rows", type=int, default=250_000)
    args = parser.parse_args(argv)

    try:
        import pyarrow.parquet as pq
    except ImportError:
        print("pyarrow is required for this converter.\n"
              "Install it, or point rank_candidates.py --freq at an existing TSV.",
              file=sys.stderr)
        return 2

    if not args.parquet.is_file():
        parser.error(f"parquet not found: {args.parquet}")

    wanted = {normalize_key(w) for w in
              args.candidates.read_text(encoding="utf-8").split("\n") if w.strip()}
    print(f"candidates               : {len(wanted)}", flush=True)

    # key -> aggregated record
    forms: dict[str, dict] = {}
    lemmas: dict[str, dict] = {}

    def bump(store: dict, key: str, record: dict) -> None:
        current = store.get(key)
        if current is None:
            store[key] = record
            return
        for field in ("freq", "lemma_freq"):
            if record.get(field) is not None:
                current[field] = (current.get(field) or 0.0) + record[field]
        for field in ("llfpm10", "lfpm10"):
            if record.get(field) is not None:
                current[field] = max(current.get(field) or 0.0, record[field])
        for field in ("form_length", "lemma_length"):
            if record.get(field) is not None and current.get(field) is None:
                current[field] = record[field]
        if record.get("lemma") and not current.get("lemma"):
            current["lemma"] = record["lemma"]
        if record.get("hunspell"):
            current["hunspell"] = True

    parquet = pq.ParquetFile(args.parquet)
    total_rows = parquet.metadata.num_rows
    read = 0
    for batch in parquet.iter_batches(batch_size=args.batch_rows, columns=COLUMNS):
        cols = {name: batch.column(i).to_pylist() for i, name in enumerate(COLUMNS)}
        for i in range(batch.num_rows):
            raw_form = cols["form"][i] or ""
            raw_lemma = cols["lemma"][i] or ""
            form_key = normalize_key(raw_form)
            lemma_key = normalize_key(raw_lemma)

            form_hit = form_key in wanted
            lemma_hit = lemma_key in wanted
            if not (form_hit or lemma_hit):
                continue

            record = {
                "lemma": raw_lemma,
                "freq": cols["freq"][i],
                "lemma_freq": cols["lemma_freq"][i],
                "llfpm10": cols["llfpm10"][i],
                "lfpm10": cols["lfpm10"][i],
                "form_length": cols["form_length"][i],
                "lemma_length": cols["lemma_length"][i],
                "hunspell": bool(cols["hunspell"][i]),
            }
            if form_hit:
                target = dict(record)
                target["form"] = raw_form
                bump(forms, form_key, target)
            if lemma_hit and not form_hit:
                target = dict(record)
                target["form"] = ""
                bump(lemmas, lemma_key, target)

        read += batch.num_rows
        if read % (2_000_000) < args.batch_rows:
            print(f"  scanned {read:,}/{total_rows:,} rows  "
                  f"form hits {len(forms):,}  lemma-only hits {len(lemmas):,}",
                  flush=True)

    print(f"scanned {read:,} rows", flush=True)
    # A key can qualify as both a form and a lemma of other forms. Emit it once:
    # the form row wins, because it is the direct observation for that spelling.
    both = set(forms) & set(lemmas)
    for key in both:
        lemmas.pop(key, None)
    print(f"form matches        : {len(forms):,}", flush=True)
    print(f"lemma-only matches  : {len(lemmas):,}", flush=True)
    print(f"also a lemma, form won: {len(both):,}", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with args.out.open("w", encoding="utf-8", newline="") as fh:
        fh.write("form\tlemma\tlemma_freq\tllfpm10\tfreq\tform_length\tlemma_length\t"
                 "lfpm10\thunspell\n")
        for key in sorted(forms):
            r = forms[key]
            written += 1
            fh.write(f"{key}\t{r['lemma']}\t{fmt(r['lemma_freq'])}\t{fmt(r['llfpm10'])}\t"
                     f"{fmt(r['freq'])}\t{fmt(r['form_length'])}\t{fmt(r['lemma_length'])}\t"
                     f"{fmt(r['lfpm10'])}\t{1 if r['hunspell'] else 0}\n")
        for key in sorted(lemmas):
            r = lemmas[key]
            written += 1
            fh.write(f"{key}\t{r['lemma']}\t{fmt(r['lemma_freq'])}\t{fmt(r['llfpm10'])}\t"
                     f"{fmt(r['freq'])}\t{fmt(r['form_length'])}\t{fmt(r['lemma_length'])}\t"
                     f"{fmt(r['lfpm10'])}\t{1 if r['hunspell'] else 0}\n")

    print(f"wrote {written:,} rows to {args.out} "
          f"({args.out.stat().st_size / 1e6:.1f} MB)", flush=True)
    return 0


def fmt(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return f"{value:g}"


if __name__ == "__main__":
    sys.exit(main())
