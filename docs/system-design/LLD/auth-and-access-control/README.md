# Auth & Access Control

| File | Covers |
|---|---|
| [jwt-and-rbac.md](jwt-and-rbac.md) | The gateway's auth flow: JWT verification → role check → trusted header injection → downstream services trust the headers, never the client |
| [idor-fix-case-study.md](idor-fix-case-study.md) | A real IDOR vulnerability that existed, was found, and was fixed — with how it was verified. The strongest single piece of security material in this repo; treat it as such in an interview |
