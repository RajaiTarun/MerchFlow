// imports

// load the .env file from the root folder
// after this we can access variables from .env using process.env.variableName
require('dotenv').config({ path: '../../.env' });

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { catalogRateLimiter, ordersRateLimiter } = require('./middleware/rateLimiter');
const authMiddleware = require('./middleware/authMiddleware');
const { requireRoles, injectClubId } = require('./middleware/rbacMiddleware');

// Full base URLs (scheme + host, no assumed port) for each downstream service.
// Default to plain local processes so `npm run dev` keeps working unchanged.
// Docker Compose overrides these to http://<service-name>:<port>. Render
// overrides them to each service's public https://...onrender.com URL — free
// Render web services can't receive private-network traffic, only send it, so
// inter-service calls there have to go out over the public internet; the
// X-Internal-Service-Key header below is what actually protects those routes,
// not which network the request travels over.
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';
const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://localhost:3002';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:3003';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004';

// Without this, http-proxy-middleware silently answers with a bare 502/504 on
// any connection failure — no indication anywhere of which target, or why.
// That made a real production failure impossible to diagnose from logs alone.
const logProxyError = (serviceName, target) => (err, req, res) => {
    console.error(
        `[API GATEWAY] Proxy error reaching ${serviceName} (${target}):`,
        err.code || err.message || err
    );
    if (res && !res.headersSent) {
        res.status(502).json({ error: `Upstream ${serviceName} unreachable` });
    }
};

// creating proxy middleware, basically routes the requests to their respective microservice
const userProxy = createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        },
        error: logProxyError('user-service', USER_SERVICE_URL)
    }
});

const clubsProxy = createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        },
        error: logProxyError('user-service', USER_SERVICE_URL)
    }
});

const catalogProxy = createProxyMiddleware({
    target: CATALOG_SERVICE_URL,
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        },
        error: logProxyError('catalog-service', CATALOG_SERVICE_URL)
    }
});

const ordersProxy = createProxyMiddleware({
    target: ORDER_SERVICE_URL,
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        },
        error: logProxyError('order-service', ORDER_SERVICE_URL)
    }
});

const notificationsProxy = createProxyMiddleware({
    target: NOTIFICATION_SERVICE_URL,
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        },
        error: logProxyError('notification-service', NOTIFICATION_SERVICE_URL)
    }
});

// Dedicated proxy for the role-promotion route. It's mounted via app.put() with
// an exact path (not app.use() prefix-mounting), so Express does NOT strip
// '/api/v1/users' from req.url the way it does for the userProxy mount below —
// pathRewrite does that stripping here instead, so user-service still sees /:userId/role.
const userRoleProxy = createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/v1/users': '' },
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        },
        error: logProxyError('user-service', USER_SERVICE_URL)
    }
});

// Same exact-path pattern as userRoleProxy above — dedicated proxy + pathRewrite
// so user-service sees /lookup instead of /api/v1/users/lookup. Used for the
// SUPER_ADMIN email-based user lookup that backs the role-promotion form.
const userLookupProxy = createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/v1/users': '' },
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        },
        error: logProxyError('user-service', USER_SERVICE_URL)
    }
});

// creating a new express application and assigning PORT to the api gateway
const app = express();
const PORT = process.env.PORT || 3000;

// using middlewares, every request is first processed by middleware
app.use(cors());

// rate limiter


// proxies
// Registered before the general '/api/v1/users' proxy so this SUPER_ADMIN-only
// route is checked first — app.use() below would otherwise swallow every method
// (including PUT) on that prefix before this route is ever reached.
app.put('/api/v1/users/:userId/role', authMiddleware, requireRoles('SUPER_ADMIN'), userRoleProxy);
// Same reasoning as the role-promotion route above: registered before the
// general '/api/v1/users' proxy so this SUPER_ADMIN-only lookup is checked
// first, and before requireAuthForProfileAccess (which only guards specific
// sub-paths and would otherwise let this one through with no auth at all).
app.get('/api/v1/users/lookup', authMiddleware, requireRoles('SUPER_ADMIN'), userLookupProxy);
// /register and /login must stay public (no JWT exists yet at that point), so
// auth is scoped to exactly these "act on my own account" routes rather than
// the whole /api/v1/users prefix. GET /profile/:userId is included here too —
// it used to be reachable with no auth at all, letting any caller read any
// user's profile by guessing/knowing their UUID. user-service now checks the
// gateway-injected x-user-id header against :userId itself (see routes/auth.js).
const PROFILE_ACCESS_ROUTES = [
    { method: 'PUT', pattern: /^\/profile$/ },
    { method: 'PUT', pattern: /^\/size$/ },
    { method: 'GET', pattern: /^\/profile\/[^/]+$/ }
];

const requireAuthForProfileAccess = (req, res, next) => {
    const needsAuth = PROFILE_ACCESS_ROUTES.some(
        route => route.method === req.method && route.pattern.test(req.path)
    );

    if (!needsAuth) {
        return next();
    }

    return authMiddleware(req, res, () => {
        // Trusted, gateway-derived identity from the verified JWT — never taken
        // from the request body or URL, so a caller can't act on another user's account.
        req.headers['x-user-id'] = req.user.sub;
        next();
    });
};

app.use('/api/v1/users', requireAuthForProfileAccess, userProxy);
// GET / (list clubs) stays open to any authenticated user, same as before.
// POST / (create club + assign admin) is SUPER_ADMIN only — same scoped-mutation
// pattern as requireClubAdminForCreate/requireClubAdminForOrders below.
const CLUB_MUTATION_ROUTES = [
    { method: 'POST', pattern: /^\/$/ }
];

const requireSuperAdminForClubCreate = (req, res, next) => {
    const isMutation = CLUB_MUTATION_ROUTES.some(
        route => route.method === req.method && route.pattern.test(req.path)
    );

    if (isMutation) {
        return requireRoles('SUPER_ADMIN')(req, res, next);
    }
    return next();
};

app.use('/api/v1/clubs', authMiddleware, requireSuperAdminForClubCreate, clubsProxy);
// Catalog mutation routes (item creation, delivery-slot updates) are restricted
// to CLUB_ADMIN (SUPER_ADMIN is always allowed through requireRoles()). Every
// other catalog route — GET listing, GET /:id, the inventory PATCH endpoints —
// must keep working for any authenticated user, so this check is scoped to
// exactly these routes rather than the whole prefix. Per-item club ownership
// (a Club Admin may only touch their own club's product) can't be checked here
// since the gateway doesn't know which club owns which Mongo item — catalog-service
// does that finer check itself using the x-club-id header injectClubId sets below.
const CATALOG_MUTATION_ROUTES = [
    { method: 'POST', pattern: /^\/$/ },
    { method: 'PUT', pattern: /^\/[^/]+\/delivery-slot$/ }
];

const requireClubAdminForCreate = (req, res, next) => {
    const isMutation = CATALOG_MUTATION_ROUTES.some(
        route => route.method === req.method && route.pattern.test(req.path)
    );

    if (isMutation) {
        return requireRoles('CLUB_ADMIN')(req, res, next);
    }
    return next();
};

app.use('/api/v1/catalog', authMiddleware, catalogRateLimiter, requireClubAdminForCreate, injectClubId, catalogProxy);

// GET /club (a club's own orders) and PATCH /:orderId/status (marking an
// order DELIVERED) are restricted to CLUB_ADMIN (SUPER_ADMIN always passes
// through requireRoles()). Every other orders route — checkout, "my orders",
// GET /:id — stays open to any authenticated user, so this check is scoped to
// exactly these routes, same pattern as requireClubAdminForCreate above.
// Per-club ownership (a Club Admin may only touch their own club's orders) is
// enforced by order-service itself using the x-club-id header injectClubId sets.
const ORDER_ADMIN_ROUTES = [
    { method: 'GET', pattern: /^\/club$/ },
    { method: 'PATCH', pattern: /^\/[^/]+\/status$/ }
];

const requireClubAdminForOrders = (req, res, next) => {
    const isAdminRoute = ORDER_ADMIN_ROUTES.some(
        route => route.method === req.method && route.pattern.test(req.path)
    );

    if (isAdminRoute) {
        return requireRoles('CLUB_ADMIN')(req, res, next);
    }
    return next();
};

app.use('/api/v1/orders', authMiddleware, ordersRateLimiter, requireClubAdminForOrders, injectClubId, ordersProxy);
app.use('/api/v1/notifications', authMiddleware, notificationsProxy);

app.use(express.json()); // basically this parses the user sent data from raw json to javascript object and if we don't use this and then do req.body the it will return undefined

// routes

// health route
// app.get(route, callback function)
// basically we are setting the response status as 200, i.e. OK and we also send a json object back to the client 
app.get('/health', (req, res) => {
    res.status(200).json({
        service: "api-gateway",
        status: "OK",
        timestamp: new Date().toISOString()
    });
});


// making the server listen on PORT : 3000
app.listen(PORT, () => {
    console.log(`[API GATEWAY] listening on port ${PORT}`);
});