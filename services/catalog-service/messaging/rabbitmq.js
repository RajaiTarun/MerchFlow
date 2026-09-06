const amqp = require('amqplib');

// Same connection-pooling pattern as order-service/messaging/rabbitmq.js —
// one connection/channel reused across publishes, lazily reconnected.
let connection = null;
let channel = null;

// Reusing the existing exchange order-service already publishes OrderPlaced to.
// It's a topic exchange, so a new routing key is all we need — no new exchange/queue.
const EXCHANGE_NAME = 'order.events';
const EXCHANGE_TYPE = 'topic';

async function connectRabbitMQ() {
    if (channel) {
        return channel;
    }

    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

    connection = await amqp.connect(rabbitmqUrl);

    connection.on('error', (err) => {
        console.error('[CATALOG SERVICE][RABBITMQ] Connection error:', err.message);
    });

    connection.on('close', () => {
        console.error('[CATALOG SERVICE][RABBITMQ] Connection closed');
        connection = null;
        channel = null;
    });

    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, {
        durable: true
    });

    console.log(`[CATALOG SERVICE][RABBITMQ] Connected. Exchange ready: ${EXCHANGE_NAME}`);

    return channel;
}

// Published only after the Mongo update has already succeeded — the catalog
// route awaits the DB save first, then fires this without awaiting the result.
async function publishDeliverySlotUpdated({ catalogItemId, itemName, deliverySlot }) {
    const ch = await connectRabbitMQ();
    const routingKey = 'delivery.slot.updated';

    // Recipients are deliberately NOT included — Catalog Service doesn't own
    // order data. Notification Service resolves recipients itself via Order Service.
    const message = {
        event: 'delivery.slot.updated',
        timestamp: new Date().toISOString(),
        catalogItemId,
        itemName,
        deliverySlot
    };

    const published = ch.publish(
        EXCHANGE_NAME,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
            persistent: true,
            contentType: 'application/json'
        }
    );

    if (!published) {
        console.warn('[CATALOG SERVICE][RABBITMQ] Publish returned false (Write buffer full, experiencing backpressure)');
    }

    console.log(`[CATALOG SERVICE][RABBITMQ] Published delivery.slot.updated: catalogItemId=${catalogItemId}`);

    return published;
}

module.exports = {
    connectRabbitMQ,
    publishDeliverySlotUpdated
};
