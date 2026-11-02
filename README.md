# TermsWatch: do the terms still say what users were promised?

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Services win users with promises in their privacy policy and terms: "we never
sell your data", "30-day refunds, no questions asked". Then the page is
quietly edited, and nobody can prove what it used to say or whether the new
wording still keeps the promise. **TermsWatch** is an Intelligent Contract that
keeps that record in public. Anyone pins a policy page and the promises it
makes; anyone can recheck it later. GenLayer validators each read the page and
must agree, promise by promise, whether it was kept, weakened or dropped. Each
check stores the hash of the text that was read, so the history is evidence.

```
anyone ── watch(name, url, promises) ── validators read the page: every promise stated? ── pin text sha256, HELD
anyone ── recheck(watch) ── validators re-read:
          same text sha256 → UNCHANGED (decided in code, no model)
          new text sha256  → per promise: kept | weakened | dropped → HELD or BROKEN
anyone ── get_history(watch) ── every check: outcome, per-promise states, text hash, who, when
```

## Live deployment

App: [termswatch.senju.quest](https://termswatch.senju.quest) (source in [`app/`](app/): watches, per-promise status, history, watch and recheck; demo policy in [`demo/`](demo/))  
Testnet Bradbury (chainId 4221): [`0xb79E24E7014b8b8d070F122604876948fd3e6152`](https://scan.testnet-chain.genlayer.com/address/0xb79E24E7014b8b8d070F122604876948fd3e6152)

## Bradbury evidence

Bradbury Phase 2 (GenVM v0.3). Run by [`tests/integration/bradbury.mjs`](tests/integration/bradbury.mjs), every check passed. Contract `0xb79E24E7014b8b8d070F122604876948fd3e6152` (deploy [`0x3361414e…`](https://scan.testnet-chain.genlayer.com/tx/0x3361414eb2c3d2c14e4ee918fe5e460f15b748278a8344de69d18d6dfe994667)), code `build/terms_watch.py`. Two accounts; validators fetched the pages live.

Real policy ([plausible.io/privacy](https://plausible.io/privacy)):

| Step | Transaction | Outcome |
|---|---|---|
| watch `https://plausible.io/no-such-policy-page` | [`0x527f17e9…`](https://scan.testnet-chain.genlayer.com/tx/0x527f17e9cf95a7d4ca25fffb488fd64f1d4829cf33b498687ce6cfa4a85b4f00) | reverted: validators agreed the page is unavailable; no watch |
| watch plausible.io/privacy for “All account data is stored only in the United States” | [`0xd65bdf1f…`](https://scan.testnet-chain.genlayer.com/tx/0xd65bdf1f00a41a515bc0250e7c6ef0c0ec29d065fd45c27d79fe3dc4a5da7125) | reverted: the page does not state commitment [1]; no baseline |
| watch plausible.io/privacy: “We never sell your data”, “You can delete your account, and all your data is permanently deleted” | [`0x8d339daa…`](https://scan.testnet-chain.genlayer.com/tx/0x8d339daa1246d91689b2c844cccdae530b0e523163458d9b97f2ccb404b29a22) | watch 0 **HELD**, both kept; text sha256 `9ecc344f1ca1…` |
| recheck watch 0 (other account) | [`0xa9a27dec…`](https://scan.testnet-chain.genlayer.com/tx/0xa9a27dece8241c3502619a86a0ade00960ac6dfbeaa71f42061b907f990dd7de) | **UNCHANGED**: same text hash, decided in code |
| recheck watch 100 | [`0x714688ae…`](https://scan.testnet-chain.genlayer.com/tx/0x714688aef24821583ef56a09a5bc30dd718c488dee97fe191fa4a0de94a65105) | reverted: watch not found |

__DEMO__

## What it does

| Layer | Mechanism | Depends on the LLM? |
|---|---|---|
| Input | Name 2–80 chars; https URL with a domain name; 1–8 distinct promises of 10–200 chars. Anything else reverts before any fetch | No |
| Baseline | A watch opens only if validators agree the page states **every** promise (`kept`); otherwise it reverts naming the missing ones. The SHA-256 of the page's visible text is pinned | Yes, by consensus |
| Recheck, same text | If the visible text hashes the same as the last check, the outcome is UNCHANGED and every promise stands, without asking the model | No |
| Recheck, new text | Validators judge each promise: kept, weakened (narrowed, conditioned, turned into "we may") or dropped (gone or contradicted) | Yes, by consensus |
| Status | BROKEN if the latest judgment has any promise not kept, else HELD | No |
| History | Every check: outcome, per-promise states, text hash and length, who rechecked, when | No |

## Consensus design

The leader fetches the page and extracts its visible text (scripts, styles,
templates and HTML comments removed; markup changes alone do not change the
text). It hashes that text; if the hash equals the watch's last one, it
returns no states and the contract keeps the previous ones. Otherwise the
model gets the fenced promises and page text and returns exactly one state per
promise from a fixed set.

Each validator re-fetches and re-reads, and accepts only if the **text hash,
text length and every state** are identical to its own. There is no
"close enough": a single promise judged differently blocks the transaction,
because it changes the stored status.

Errors follow the official classes: an unreachable page or one over 20,000
characters reverts with an agreed `[EXTERNAL]`/`[EXPECTED]` error, so a policy
is never judged on part of its text and the watch is unchanged; a malformed
model answer is `[LLM_ERROR]` and a new leader is chosen.

## Limits

- The hash covers the page's visible text as served to validators. A cookie
  banner, a date or a rotating element in the body changes the hash every
  time; then each recheck is judged by the model again (the result is the
  same if the promises are unchanged, just slower).
- The record says what the page said **when someone rechecked it**. Nothing
  is watched in between: a change that is made and reverted between two
  rechecks is not seen.
- "Weakened" is a judgment. Validators must agree on it exactly; if they
  cannot, nothing is stored and the recheck can be sent again.
- Promises spread across several pages (policy + separate refund page) need
  one watch per page.
- Text behind JavaScript or a login is not seen; such a page cannot be a
  baseline.

## API

| Method | Who | Notes |
|---|---|---|
| `watch(name, url, commitments_json)` | anyone | JSON list of strings; returns the watch id |
| `recheck(watch_id)` | anyone | returns `{outcome, status, states}` |
| `get_watch(id)`, `get_watches(start)`, `get_count()` | view | up to 50 per page |
| `get_history(watch_id, start)` | view | oldest first, up to 50 per page |

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
genvm-lint check contracts/terms_watch.py
pytest tests/direct -v                         # 17 tests
node app/check-actions.mjs app/index.html      # Watch / Recheck follow the contract's rules
# integration, on Bradbury, against the packed code (keys in GL_PK0..1 env vars)
python deploy/shrink.py contracts/terms_watch.py build/terms_watch.py --pack
npm i genlayer-js@2.0.0-rc.2   # plus the fee-estimate patch in app/README.md
node tests/integration/bradbury.mjs build/terms_watch.py
```

Deploy the output of `deploy/shrink.py` (AST-checked, 4.2 KB packed). CI
re-runs the direct tests against the packed code.

## Tests (17 direct, Bradbury E2E)

- **Input**: every field's limits, JSON shape, count, length and duplicate promises.
- **Baseline**: hash pinned; a page that does not state a promise is refused.
- **Rechecks**: same text is UNCHANGED without asking the model (even when the model would now say "dropped"); scripts, comments and attribute changes do not change the hash; changed text is judged per promise, BROKEN then HELD again, history kept; unavailable and oversized pages revert and record nothing; malformed model answers.
- **Consensus**: a validator rejects a different state, hash or a skipped judgment; validators agree on the same page error only.
