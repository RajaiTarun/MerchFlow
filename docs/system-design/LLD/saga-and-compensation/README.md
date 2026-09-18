# Saga & Compensation

One doc: [saga-rollback.md](saga-rollback.md) — what happens when a checkout has already reserved stock in MongoDB and then fails before the order can be committed in Postgres. This is the mechanism that keeps the two databases consistent without a shared transaction manager between them.
