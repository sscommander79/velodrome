# Out-of-scope decisions

Rejected or deliberately deferred directions whose reasoning is likely to matter
again. The only job of this directory is to stop a future session — human or
agent — from re-litigating a call that has already been settled.

One short Markdown file per direction, named for the concept
(`cross-encoder-reranking.md`, not `2026-07-adr-3.md`). Include:

- **The direction considered** — stated strongly enough that someone could
  advocate for it.
- **Why it is out of scope now** — the actual reason, not "not a priority".
- **Evidence** — the measurement, review finding, or accepted decision that
  supports the boundary. A rejection with no evidence is a preference, and
  preferences get overturned by whoever argues last.
- **Where it was adjudicated** — the commit, phase, review, or conversation.
- **A concrete revisit condition** — the specific thing that would have to
  change. "Maybe later" is not a revisit condition.

## What does not belong here

- **Actionable work.** Anything you intend to build belongs in the roadmap,
  backlog, or parking lot. This directory is for directions that are *closed*.
- **One-off ideas that were never seriously considered.** A graveyard nobody
  reads is worse than no register, because it trains you to skip the folder.
- **Decisions still in flight.** Record those where the work is.

The test for an entry: if someone proposed this next month, would this file
change the outcome of that conversation? If not, don't write it.

## Maintenance

An entry whose revisit condition has been met is no longer out of scope —
either reopen the direction or replace the condition with what you learned.
Stale entries are what make future readers stop trusting the register.
