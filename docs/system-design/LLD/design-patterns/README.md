# Design Patterns

Four patterns, each solving one real seam in the codebase — not sprinkled in for a resume line. Every one of these was already named in a code comment before this doc existed (grep any of the class names below and you'll find the pattern name in the file header).

| Pattern | Where | What it's actually solving |
|---|---|---|
| [Factory](factory-pattern.md) | `services/catalog-service/factories/MerchandiseFactory.js` | One `type` string branches into three differently-shaped domain objects (Apparel needs sizes, Mug/Accessory don't) without an `if/else` chain leaking into the route handler |
| [Builder](builder-pattern.md) | `services/user-service/models/StudentProfileBuilder.js` | A partial-update profile PATCH where only some fields arrive, each with its own validation, assembled into one clean update object |
| [Command](command-pattern.md) | `services/order-service/models/OrderCommand.js` | Bundling everything a checkout needs (and validating it up front) into one object before any side effect happens |
| [Strategy + Observer](strategy-observer-pattern.md) | `services/notification-service/observers/NotificationBroadcaster.js` + `strategies/` | Decoupling "an event happened" from "how it gets delivered," so a second delivery channel can be added without touching the RabbitMQ consumer |

Each doc names the rejected alternative explicitly — usually "just write an if/else" — and says concretely why the pattern earns its complexity here (or, honestly, where it's arguably more structure than a project this size strictly needs).
