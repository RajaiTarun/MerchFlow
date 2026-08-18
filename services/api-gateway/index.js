// imports

// load the .env file from the root folder
// after this we can access variables from .env using process.env.variableName
require('dotenv').config({ path: '../../.env' });

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const mongoSanitize = require('express-mongo-sanitize');
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

// creating a new express application and assigning PORT to the api gateway
const app = express();
const PORT = process.env.PORT || 3000;

// using middlewares, every request is first processed by middleware
app.use(cors());

// rate limiter


// proxies
app.use('/api/v1/users', userProxy);
app.use('/api/v1/catalog', authMiddleware, catalogRateLimiter, injectClubId, catalogProxy);
app.use('/api/v1/orders', authMiddleware, ordersRateLimiter, ordersProxy);


app.use(express.json()); // basically this parses the user sent data from raw json to javascript object and if we don't use this and then do req.body the it will return undefined
app.use(mongoSanitize());

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