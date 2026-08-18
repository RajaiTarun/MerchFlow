const express = require('express');
const amqp = require('amqplib'); // this is basically rabbitmq's node driver/ client
require('dotenv').config({ path: '../../.env' });

const app = express();
const PORT = process.env.NOTIFICATION_SERVICE_PORT || 3004;

let channel = null;
const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL);
        channel = await connection.createChannel();
        console.log('[NOTIFICATION SERVICE] rabit mq connected');
    } catch (err) {
        console.error('[NOTIFICATION SERVICE] error while connecting to rabbit mq');
        throw err;
    }
}

app.get('/health', (req, res) => {
    res.status(200).json({
        serivce: 'notification-service',
        status: 'OK',
        rabbitmq: channel ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    })
})

const startServer = async () => {
    try {
        await connectRabbitMQ();
        app.listen(PORT, () => {
            console.log(`[NOTIFICATION SERVICE] listening on port ${PORT}`);
        })
    } catch (err) {
        console.error("Failed to start Notification Service server");
        process.exit(1);
    }
}

startServer();