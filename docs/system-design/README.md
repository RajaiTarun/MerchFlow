# System Design Docs

This folder is interview-prep material. `docs/PRD.md`, `docs/ADR.md` and the other top-level docs describe *what* the system does and *why* each decision was made; they were revised on 2026-10-24 to match the built system. Everything here goes one level deeper into *how* it works, cross-checked against the real code in `services/`. Where something is a known limit or gap, it's called out explicitly rather than smoothed over.

## HLD vs LLD, in this repo's terms

- **[HLD](HLD/)** — the shape of the system from the outside: who talks to whom, which service owns which data, what the request path looks like end to end. Four files, meant to be read in order (01 → 04).
- **[LLD](LLD/)** — the mechanism inside each interesting seam: the actual lock/retry/cache code, why it's built that way, and what else was considered and rejected. Organized by concern (concurrency, caching, auth, etc.), not by service — the same concern (e.g. "what happens under concurrent access") often spans two or three services.

## How to use this for interview prep

Don't try to memorize these. The useful skill is: pick any one mechanism (the distributed lock, the saga rollback, the IDOR fix), and be able to explain it in three layers — what breaks without it (a concrete failure scenario), how the fix actually works (the mechanism, in code terms), and what else could have worked instead and why it wasn't chosen. Every LLD doc is written in that shape on purpose. The [IDOR case study](LLD/auth-and-access-control/idor-fix-case-study.md) and the [checkout sequence diagram](HLD/03-request-lifecycle-checkout.md) are the two strongest single artifacts here if you only have time to review two things before an interview.
