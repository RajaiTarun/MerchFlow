const Redis = require('ioredis');
const redis = new Redis(process.env.VALKEY_URL);

redis.on('connect', () => console.log('[CATALOG SERVICE] Valkey connected'));

redis.on('error', (err) => {
    console.error('[CATALOG SERVICE] Valkey error:', err);
});

module.exports = redis;