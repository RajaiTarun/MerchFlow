# System Design Docs

This folder is interview-prep material, not planning docs. The difference matters: `docs/PRD.md`, `docs/ADR.md`, etc. describe what was *decided* and *why*, written mostly before or during the build. Everything here describes what actually *shipped*, cross-checked against the real code in `services/` — and where the two disagree, that disagreement is called out explicitly rather than smoothed over. If you're prepping to talk about this project in an interview, read from here, not from the planning docs.

## HLD vs LLD, in this repo's terms

- **[HLD](HLD/)** — the shape of the system from the outside: who talks to whom, which service owns which data, what the request path looks like end to end. Four files, meant to be read in order (01 → 04).
- **[LLD](LLD/)** — the mechanism inside each interesting seam: the actual lock/retry/cache code, why it's built that way, and what else was considered and rejected. Organized by concern (concurrency, caching, auth, etc.), not by service — the same concern (e.g. "what happens under concurrent access") often spans two or three services.

## How to use this for interview prep

Don't try to memorize these. The useful skill is: pick any one mechanism (the distributed lock, the saga rollback, the IDOR fix), and be able to explain it in three layers — what breaks without it (a concrete failure scenario), how the fix actually works (the mechanism, in code terms), and what else could have worked instead and why it wasn't chosen. Every LLD doc is written in that shape on purpose. The [IDOR case study](LLD/auth-and-access-control/idor-fix-case-study.md) and the [checkout sequence diagram](HLD/03-request-lifecycle-checkout.md) are the two strongest single artifacts here if you only have time to review two things before an interview.
