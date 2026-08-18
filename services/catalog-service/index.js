require('dotenv').config({ path: '../../.env' });
const express = require('express');
const mongoose = require('mongoose');
const catalogRoutes = require('./routes/catalog');

// mongoose is an ODM object data modelling library
// node -> mongoose -> mongo db

const app = express();
const PORT = process.env.CATALOG_SERVICE_PORT || 3002;

const internalAuthMiddleware = (req, res, next) => {
    if (req.headers['x-internal-service-key'] && req.headers['x-internal-service-key'] === process.env.INTERNAL_SERVICE_KEY) {
        return next();
    }

    res.status(403).json({
        error: 'forbidden'
    })
}

app.use(express.json());
app.use(internalAuthMiddleware);
app.use('/', catalogRoutes);

// creating a function to connect to mongo db and as connecting to db takes time and might also sometimes fail, so we are using async await + try catch
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('[CATALOG SERVICE] Mongo DB connected');
    } catch (err) {
        console.error('[CATALOG SERVICE] Mongo DB connection error', err);
        throw err;
    }
};


// route to get health
app.get('/health', (req, res) => {
    const isConnected = mongoose.connection.readyState === 1;
    if (isConnected) {
        res.status(200).json({
            service: 'catalog-service',
            status: 'OK',
            db: 'connected',
            timestamp: new Date().toISOString()
        })
    } else {
        res.status(500).json({
            service: 'catalog-service',
            status: 'ERROR',
            db: 'disconnected',
            timestamp: new Date().toISOString()
        })
    }
})

// basically we are starting the server and once the server has started we establish connection with mongo db

// there is a flaw here : what if the server starts but the db does not start ?? because after server start connectDB can still fail right, so there is an alternative : do connectDB first and then once db started succesfully then start the server 

// and also there is one more flaw what if the server started at t= 0s and db starts at t=5s then between 0 and 5s if any requests sent then that requests will not be handeled

// app.listen(PORT, async () => {
//     console.log(`[CATALOG SERVICE] listening on port ${PORT}`);
//     await connectDB();
// })

// let's fix this flaw


const startServer = async () => {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`[CATALOG SERVICE] listening on port ${PORT}`);
        })
    } catch (err) {
        console.log('[CATALOG SERVICE] failed to start server');
        process.exit(1);
    }
}

startServer();

// mongo db also does pooling but instead of setting it up explicitly the mongoose driver does it internally
