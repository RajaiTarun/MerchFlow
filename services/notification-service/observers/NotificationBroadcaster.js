// Observer Pattern — the RabbitMQ consumer notifies this broadcaster of an event,
// and the broadcaster fans it out to every registered notification strategy/observer.
// The broadcaster does not know HOW a notification is delivered — that's each observer's job.

class NotificationBroadcaster {
    constructor() {
        this.observers = [];
    }

    register(observer) {
        this.observers.push(observer);
    }

    async notify(payload) {
        for (const observer of this.observers) {
            await observer.execute(payload);
        }
    }
}

module.exports = NotificationBroadcaster;
