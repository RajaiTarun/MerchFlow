const amqp = require('amqplib');

// Connection and channel are declared at the module level.
// This is called "Connection Pooling". RabbitMQ connections are heavy (TCP handshake, authentication),
// so we reuse a single connection and channel for all messages sent by this microservice.
let connection = null;
let channel = null;

// The exchange name and type. 
// A 'topic' exchange allows us to route messages to different queues based on a routing key (e.g. 'order.placed').
const EXCHANGE_NAME = 'order.events';
const EXCHANGE_TYPE = 'topic';

async function connectRabbitMQ() {
    // If we already have an active channel, return it immediately.
    // This allows us to call connectRabbitMQ() before every publish without any performance penalty.
    if (channel) {
        return channel;
    }

    const rabbitmqUrl =
        process.env.RABBITMQ_URL || 'amqp://localhost:5672';

    // 1. Establish the TCP connection to the RabbitMQ broker
    connection = await amqp.connect(rabbitmqUrl);

    // 2. Setup error handlers.
    // If RabbitMQ crashes or the network drops, these listeners will trigger.
    connection.on('error', (err) => {
        console.error(
            '[RABBITMQ] Connection error:',
            err.message
        );
    });

    // When the connection closes, we nullify the connection and channel.
    // This creates "lazy auto-reconnect" behavior: the next time publishOrderPlaced() 
    // is called, `channel` will be null, and it will automatically try to reconnect.
    connection.on('close', () => {
        console.error('[RABBITMQ] Connection closed');
        connection = null;
        channel = null;
    });

    // 3. Create a channel. A channel is a virtual connection inside the real TCP connection.
    channel = await connection.createChannel();

    // 4. Assert the exchange exists.
    // If the exchange doesn't exist, RabbitMQ will create it. 
    // `durable: true` means the exchange will survive a RabbitMQ server restart.
    await channel.assertExchange(
        EXCHANGE_NAME,
        EXCHANGE_TYPE,
        {
            durable: true
        }
    );

    console.log(
        `[RABBITMQ] Connected. Exchange ready: ${EXCHANGE_NAME}`
    );

    return channel;
}

// Function to publish the 'OrderPlaced' event.
// Taking the 'order' object from PostgreSQL as an argument.
async function publishOrderPlaced(order) {
    // Ensure we are connected. Will reuse existing channel if already connected.
    const channel = await connectRabbitMQ();

    // The routing key helps downstream services filter which events they want to listen to.
    const routingKey = 'order.placed';

    // Construct the event payload
    const message = {
        event: 'OrderPlaced',
        timestamp: new Date().toISOString(),
        order // Include the full order details for the consumer (e.g., a notification service)
    };

    // 5. Publish the message to the exchange
    // channel.publish takes a Buffer. We convert the JSON object to a string, then to a Buffer.
    const published = channel.publish(
        EXCHANGE_NAME,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
            // persistent: true tells RabbitMQ to save this message to disk if there are queues bound to it.
            // This prevents message loss if RabbitMQ crashes before delivering it.
            persistent: true,
            contentType: 'application/json'
        }
    );

    // Under extremely heavy load, the underlying TCP write buffer can get full.
    // If this happens, channel.publish returns false. RabbitMQ will ask Node.js to pause sending.
    if (!published) {
        console.warn(
            '[RABBITMQ] Publish returned false (Write buffer full, experiencing backpressure)'
        );
    }

    console.log(
        `[RABBITMQ] Published OrderPlaced: orderId=${order.id}`
    );

    return published;
}

module.exports = {
    connectRabbitMQ,
    publishOrderPlaced
};
