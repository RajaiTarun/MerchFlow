const Redis = require('ioredis');
const redis = new Redis(process.env.VALKEY_URL);

redis.on('error', (err) => console.error('[RATE LIMITER] Valkey connection error:', err.message));

const createRateLimiter = (maxTokens, windowMs) => {
    return async (req, res, next) => {
        const key = `rate_limit:${req.ip}`;
        try {
            const current = await redis.get(key);

            if (current == null) {
                // basically this means that the current user is coming for the first time in the current window time period, so we basically set the limit to maxTokens - 1
                await redis.set(key, maxTokens - 1, 'PX', windowMs);
                return next();
            }

            if (parseInt(current) <= 0) {
                // the user has exhausted the limit, so what we are doing is that, we see the seconds left until user gets another set of tries
                // for that we use pttl and it gives time in ms
                const ttlMs = await redis.pttl(key);

                // but http wants retry-after time in seconds so we convert it in seconds
                const retryAfterSeconds = Math.max(
                    1,
                    Math.ceil(ttlMs / 1000)
                );

                res.set('Retry-After', retryAfterSeconds.toString());

                return res.status(429).json({
                    error: 'RATE_LIMITED',
                    retryAfter: retryAfterSeconds
                });
            }

            await redis.decr(key);
            return next();
        } catch (err) {
            // this basically means that valkey is down
            console.error('[RATE LIMITER] REDIS DOWN, SO BYPASSING RATE LIMITING');
            return next();
        }
    }
}

const catalogRateLimiter = createRateLimiter(1000, 60000); // 100
const ordersRateLimiter = createRateLimiter(1000, 60000); // 5

module.exports = { catalogRateLimiter, ordersRateLimiter };