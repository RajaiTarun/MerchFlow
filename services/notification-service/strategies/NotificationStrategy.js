// Strategy Pattern — base contract for HOW a notification is delivered/processed.
// Concrete strategies (InAppNotificationStrategy, future EmailStrategy, etc.) implement execute().

class NotificationStrategy {
    async execute(payload) {
        throw new Error('execute(payload) must be implemented by a NotificationStrategy subclass');
    }
}

module.exports = NotificationStrategy;
