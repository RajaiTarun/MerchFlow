const Redis = require('ioredis');
const redis = new Redis(process.env.VALKEY_URL);

redis.on('error', (err) => console.error('[RATE LIMITER] Valkey connection error:', err.message));

// Atomically checks-and-decrements the token count for this window, in one
// Redis round trip (Redis runs a Lua script atomically - no other command can
// interleave with it, the same technique already used for LUA_RELEASE_LOCK in
// order-service/routes/orders.js).
//
// This fixes a real race condition the previous plain GET-then-DECR had:
// two concurrent requests from the same IP could both read the same "1 token
// left" value before either of them decremented it, so both would pass the
// "> 0" check and both decrement - driving the counter negative instead of
// stopping cleanly at 0.
//
// It also defensively re-applies the key's expiry if it's ever found missing
// (PTTL < 0 means "no expiry set"), so a bucket can never get permanently
// stuck rate-limiting forever - every path through this script guarantees the
// key has a TTL before it returns, which is what actually makes the limit
// "regenerate after every time window" instead of only regenerating if
// nothing ever goes wrong with the key's expiry.
//
// KEYS[1] = rate limit key
// ARGV[1] = maxTokens
// ARGV[2] = window length in ms
//
// Returns {1, tokensRemaining} if allowed, or {0, currentTokens, ttlMs} if
// this request should be rate-limited.
const RATE_LIMIT_SCRIPT = `
local current = redis.call("GET", KEYS[1])

if current == false then
    redis.call("SET", KEYS[1], ARGV[1] - 1, "PX", ARGV[2])
    return {1, tonumber(ARGV[1]) - 1}
end

current = tonumber(current)

if current <= 0 then
    local ttl = redis.call("PTTL", KEYS[1])
    if ttl < 0 then
        redis.call("PEXPIRE", KEYS[1], ARGV[2])
        ttl = tonumber(ARGV[2])
    end
    return {0, current, ttl}
end

redis.call("DECR", KEYS[1])
local ttlAfter = redis.call("PTTL", KEYS[1])
if ttlAfter < 0 then
    redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return {1, current - 1}
`;

const createRateLimiter = (maxTokens, windowMs, name) => {
    return async (req, res, next) => {
        // name scopes the key per limiter — without it, catalogRateLimiter and
        // ordersRateLimiter would compute the same key for a given IP and end up
        // sharing one bucket instead of each having their own.
        const key = `rate_limit:${name}:${req.ip}`;
        try {
            const [allowed, , ttlMs] = await redis.eval(
                RATE_LIMIT_SCRIPT,
                1,
                key,
                maxTokens,
                windowMs
            );

            if (allowed === 1) {
                return next();
            }

            const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
            res.set('Retry-After', retryAfterSeconds.toString());

            return res.status(429).json({
                error: 'RATE_LIMITED',
                retryAfter: retryAfterSeconds
            });
        } catch (err) {
            // this basically means that valkey is down
            console.error('[RATE LIMITER] REDIS DOWN, SO BYPASSING RATE LIMITING');
            return next();
        }
    }
}

const catalogRateLimiter = createRateLimiter(1000, 60000, 'catalog'); // 100
const ordersRateLimiter = createRateLimiter(1000, 60000, 'orders'); // 5

module.exports = { catalogRateLimiter, ordersRateLimiter };
