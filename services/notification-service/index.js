const express = require('express');
const amqp = require('amqplib'); // this is basically rabbitmq's node driver/ client
require('dotenv').config({ path: '../../.env' });

const app = express();
const PORT = process.env.NOTIFICATION_SERVICE_PORT || 3004;

const EXCHANGE_NAME = 'order.events';
const EXCHANGE_TYPE = 'topic';
const QUEUE_NAME = 'notification_queue';
const ROUTING_KEY = 'order.placed';

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

        // now we are binding the queue with the exchange
        await channel.bindQueue(
            QUEUE_NAME,
            EXCHANGE_NAME,
            ROUTING_KEY
        )

        channel.consume(
            QUEUE_NAME,
            (msg) => {
                try {
                    const message = JSON.parse(msg.content.toString());

                    console.log(
                        `[NOTIFICATION SERVICE] OrderPlaced received: orderId=${message.order.id}, email=${message.order.studentEmail}, item=${message.order.itemName}`
                    );

                    channel.ack(msg);
                } catch (err) {
                    console.error(
                        '[NOTIFICATION SERVICE] Failed to process message:',
                        err.message
                    );
                }
            }
        )
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