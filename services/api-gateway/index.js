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


// creating proxy middleware, basically routes the requests to their respective microservice
const userProxy = createProxyMiddleware({
    target: 'http://localhost:3001',
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        }
    }
});

const clubsProxy = createProxyMiddleware({
    target: 'http://localhost:3001',
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        }
    }
});

const catalogProxy = createProxyMiddleware({
    target: 'http://localhost:3002',
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        }
    }
});

const ordersProxy = createProxyMiddleware({
    target: 'http://localhost:3003',
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        }
    }
});

const notificationsProxy = createProxyMiddleware({
    target: 'http://localhost:3004',
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        }
    }
});

// Dedicated proxy for the role-promotion route. It's mounted via app.put() with
// an exact path (not app.use() prefix-mounting), so Express does NOT strip
// '/api/v1/users' from req.url the way it does for the userProxy mount below —
// pathRewrite does that stripping here instead, so user-service still sees /:userId/role.
const userRoleProxy = createProxyMiddleware({
    target: 'http://localhost:3001',
    changeOrigin: true,
    pathRewrite: { '^/api/v1/users': '' },
    on: {
        proxyReq: (proxyReq) => {
            proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
        }
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
// /register and /login must stay public (no JWT exists yet at that point), so
// auth is scoped to exactly these two "act on my own account" routes rather
// than the whole /api/v1/users prefix.
const PROFILE_MUTATION_ROUTES = [
    { method: 'PUT', pattern: /^\/profile$/ },
    { method: 'PUT', pattern: /^\/size$/ }
];

const requireAuthForProfileMutation = (req, res, next) => {
    const needsAuth = PROFILE_MUTATION_ROUTES.some(
        route => route.method === req.method && route.pattern.test(req.path)
    );

    if (!needsAuth) {
        return next();
    }

    return authMiddleware(req, res, () => {
        // Trusted, gateway-derived identity from the verified JWT — never taken
        // from the request body, so a caller can't act on another user's account.
        req.headers['x-user-id'] = req.user.sub;
        next();
    });
};

app.use('/api/v1/users', requireAuthForProfileMutation, userProxy);
app.use('/api/v1/clubs', authMiddleware, clubsProxy);
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