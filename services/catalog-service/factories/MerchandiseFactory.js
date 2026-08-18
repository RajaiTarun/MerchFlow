const Apparel = require('../domain/Apparel');
const Mug = require('../domain/Mug');
const Accessory = require('../domain/Accessory');

class MerchandiseFactory {
    static createItem(type, payload) {
        switch (type.toUpperCase()) {

            case 'APPAREL':
                // Returns an Apparel instance — validation happens inside the constructor
                return new Apparel(payload);

            case 'MUG':
                return new Mug(payload);

            case 'ACCESSORY':
                return new Accessory(payload);

            default:
                throw new Error(`Unknown item type: "${type}". Valid types are APPAREL, MUG, ACCESSORY`);
        }
    }
}

module.exports = MerchandiseFactory;
