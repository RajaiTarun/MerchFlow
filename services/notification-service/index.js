const express = require('express');
const amqp = require('amqplib'); // this is basically rabbitmq's node driver/ client
const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config({ path: '../../.env' });
const NotificationBroadcaster = require('./observers/NotificationBroadcaster');
const InAppNotificationStrategy = require('./strategies/InAppNotificationStrategy');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.NOTIFICATION_SERVICE_PORT || 3004;

// Same convention as catalog/order/user-service: only the gateway (or another
// trusted internal service) may reach this service directly.
const internalAuthMiddleware = (req, res, next) => {
    if (req.headers['x-internal-service-key'] && req.headers['x-internal-service-key'] === process.env.INTERNAL_SERVICE_KEY) {
        return next();
    }

    res.status(403).json({
        error: 'forbidden'
    })
}

const EXCHANGE_NAME = 'order.events';
const EXCHANGE_TYPE = 'topic';
const QUEUE_NAME = 'notification_queue';
// Both event types share the same queue/consumer — this is the smaller,
// intentionally chosen architecture: Notification Service resolves recipients
// itself via a direct HTTP call to Order Service, rather than Order Service
// becoming a second RabbitMQ consumer/publisher.
const ROUTING_KEYS = ['order.placed', 'delivery.slot.updated', 'order.delivered'];

// Default to 'localhost' for plain local `npm run dev`; Docker Compose
// overrides this to the order-service container name.
const ORDER_SERVICE_HOST = process.env.ORDER_SERVICE_HOST || 'localhost';
const ORDER_SERVICE_URL = `http://${ORDER_SERVICE_HOST}:${process.env.ORDER_SERVICE_PORT || 3003}`;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    max: 10
});

// Observer setup — the InAppNotificationStrategy is registered as an observer.
// The RabbitMQ consumer only talks to the broadcaster; it never calls the strategy directly.
const broadcaster = new NotificationBroadcaster();
broadcaster.register(new InAppNotificationStrategy(pool));

async function handleOrderPlaced(message) {
    const order = message.order;

    console.log(
        `[NOTIFICATION SERVICE] OrderPlaced received: orderId=${order.id}, email=${order.studentEmail}, item=${order.itemName}`
    );

    await broadcaster.notify({
        userId: order.user_id,
        orderId: order.id,
        type: 'ORDER_PLACED',
        message: `Your order for ${order.itemName} has been placed successfully.`,
        metadata: {
            itemName: order.itemName,
            studentEmail: order.studentEmail,
            quantity: order.quantity,
            selectedSize: order.selected_size
        }
    });
}

async function handleOrderDelivered(message) {
    const order = message.order;

    console.log(
        `[NOTIFICATION SERVICE] OrderDelivered received: orderId=${order.id}, item=${order.itemName}`
    );

    await broadcaster.notify({
        userId: order.user_id,
        orderId: order.id,
        type: 'ORDER_DELIVERED',
        message: `Your order for ${order.itemName} has been delivered successfully.`,
        metadata: {
            itemName: order.itemName,
            quantity: order.quantity,
            selectedSize: order.selected_size
        }
    });
}

async function handleDeliverySlotUpdated(message) {
    const { catalogItemId, itemName, deliverySlot } = message;

    console.log(
        `[NOTIFICATION SERVICE] DeliverySlotUpdated received: catalogItemId=${catalogItemId}, item=${itemName}`
    );

    // HTTP call to Order Service, not a second RabbitMQ hop — this is the
    // intentionally simpler architecture for NTF-502's delivery-slot flow.
    const response = await axios.get(
        `${ORDER_SERVICE_URL}/by-item/${catalogItemId}/users`,
        { headers: { 'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY } }
    );

    const userIds = response.data.userIds || [];

    if (userIds.length === 0) {
        console.log(`[NOTIFICATION SERVICE] No users found for catalog item ${catalogItemId}`);
        return;
    }

    const message_ = `Delivery slot updated for ${itemName}: ${deliverySlot.date}, ${deliverySlot.startTime} - ${deliverySlot.endTime}.`;

    // One notify() call per distinct user — userIds is already deduplicated by
    // Order Service's SELECT DISTINCT, so a user with several orders for the
    // same item still gets exactly one notification here.
    for (const userId of userIds) {
        await broadcaster.notify({
            userId,
            orderId: null,
            type: 'DELIVERY_SLOT_UPDATED',
            message: message_,
            metadata: { catalogItemId, deliverySlot }
        });
    }
}

let channel = null;
let connection = null;
const connectRabbitMQ = async () => {
    try {
        connection = await amqp.connect(process.env.RABBITMQ_URL);
        connection.on('error', (err) => {
            console.error(
                '[NOTIFICATION SERVICE] RabbitMQ connection error:',
                err.message
            );
        })

        connection.on('close', () => {
            console.error(
                '[NOTIFICATION SERVICE] RabbitMQ connection closed'
            );

            connection = null;
            channel = null;
        })
        channel = await connection.createChannel();

        channel.on('error', (err) => {
            console.error(
                '[NOTIFICATION SERVICE] RabbitMQ channel error:',
                err.message
            );
        })
        console.log('[NOTIFICATION SERVICE] rabit mq connected');

        // we are making sure that the exchange with the given details exists and if not then we create it
        await channel.assertExchange(
            EXCHANGE_NAME,
            EXCHANGE_TYPE,
            {
                durable: true // durable true means that the exchange survies a broker restart
            }
        )

        // we are making sure that the queue with the given details exists and if not then we create it
        await channel.assertQueue(
            QUEUE_NAME,
            {
                durable: true // true means that the queue survives the message broker restart
            }
        )

        // now we are binding the queue with the exchange, once per routing key —
        // same queue, same consumer handles both event types.
        for (const routingKey of ROUTING_KEYS) {
            await channel.bindQueue(
                QUEUE_NAME,
                EXCHANGE_NAME,
                routingKey
            )
        }

        channel.consume(
            QUEUE_NAME,
            async (msg) => {
                if (!msg) return;

                try {
                    const message = JSON.parse(msg.content.toString());

                    // Consumer only receives + parses + delegates. All notification
                    // business logic lives in the broadcaster's registered strategies.
                    if (message.event === 'OrderPlaced') {
                        await handleOrderPlaced(message);
                    } else if (message.event === 'OrderDelivered') {
                        await handleOrderDelivered(message);
                    } else if (message.event === 'delivery.slot.updated') {
                        await handleDeliverySlotUpdated(message);
                    } else {
                        console.warn(`[NOTIFICATION SERVICE] Unknown event type: ${message.event}`);
                    }

                    // Ack only after the notification(s) has been successfully persisted.
                    channel.ack(msg);
                } catch (err) {
                    console.error(
                        '[NOTIFICATION SERVICE] Failed to process message:',
                        err
                    );

                    // retrying is not in my scope as of now, if i have time will try something like retry mechanism
                }
            }
        )
    } catch (err) {
        console.error('[NOTIFICATION SERVICE] error while connecting to rabbit mq');
        throw err;
    }
}

app.use(express.json());
app.use(internalAuthMiddleware);
app.use('/', notificationRoutes(pool));

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