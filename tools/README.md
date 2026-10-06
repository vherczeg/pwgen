# Wordlist pipeline (`tools/`)

Reusable, documented pipeline that turns a source dictionary plus a trusted
frequency corpus into a verified passphrase word list. It is currently wired for
**Hungarian** and is deliberately *not* a generic multi-language framework yet —
every script marks what is generic and what is language-specific in its module
docstring ("Reuse in another language"), and the language-specific constant
blocks are marked with `LANGUAGE-SPECIFIC BLOCK`.

## Pipeline

1. **Source dictionary** — `build_wordlist.py --dic hu_HU.dic`
   parses a Hunspell `.dic` (or any one-word-per-line list) and applies the
   mechanical cleaning rules: allowed characters, length window, punctuation,
   digits, whitespace, case merging, duplicate removal. Also compares against
   the current production list and reports what would be added.
2. **Cleaning review** — the same run writes `review/rejected_*.txt` and
   `review/review_*.txt` so a human can audit the filters before trusting them.
3. **Frequency extraction** — `extract_frequency_table.py` converts a large
   frequency dataset (parquet) into a compact TSV. This is the only script that
   needs a third-party reader; the rest stay on the standard library.
4. **Ranking / filtering** — `rank_candidates.py --freq <table>` matches every
   candidate to corpus lemmas/forms (NFC + case-folded, exact matches only),
   ranks by real corpus frequency, never invents a value, and builds *protected*
   pools that always contain every word of the current production list.
5. **Pool analysis** — `analyze_pools.py` slices the ranked table into the
   power-of-two pools under consideration and produces incremental sets,
   boundary samples, random/bottom/tail review samples, frequency-decay
   statistics and the exact word-selection entropy (`log2(pool size)`).
6. **Production migration** — the selected pool is written into the production
   word list `lang/<iso639-3>.js` (`window.HU_WORDS = [...]`), which
   `index.html` loads with a classic `<script>` tag. Entropy is derived from the
   active list size, so the generator needs no change.

Steps 1–5 never write to `lang/` or `index.html`; the migration is a separate,
reviewed step.

## Adding another language

Provide:

- a **source dictionary / lexical dataset** (Hunspell `.dic` or a plain list),
- a **trusted frequency corpus or frequency list** for that language,
- **language-specific character/alphabet rules**, digraphs and accented letters
  included — see the marked constants in `build_wordlist.py` and
  `rank_candidates.py`,
- **language-specific proper-name / abbreviation rules** — the current
  heuristics rely on Hungarian capitalisation and orthography.

Pool size: **16,384 = 2^14** was chosen for Hungarian after manual quality
review (exactly 14 bits per selected word, because the size is a power of two).
Another language does **not** have to use 16,384 — pick the size where quality
stops improving. A non-power-of-two size is fine; the per-word entropy simply
becomes a non-integer value.

## What is committed

- the scripts in this directory and this README,
- `wordlist_analysis/stage2/SOURCES-AND-LICENSES.txt` (provenance/licensing).

Everything else the pipeline produces — candidate lists, ranking CSV/TSV,
review and sample files, pool files, temporary reports — is generated data and
is git-ignored (see the repository root `.gitignore`). The production word list
`lang/hun.js` is the single source of truth for the 16,384 Hungarian words.
