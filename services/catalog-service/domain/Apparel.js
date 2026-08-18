class Apparel {
    constructor(payload) {
        if (!payload.availableSizes || payload.availableSizes.length === 0) {
            throw new Error('APPAREL items must have at least one availableSize');
        }

        const {
            name,
            description,
            price,
            clubId,
            stock,
            availableSizes,
            ...dynamicFields
        } = payload;

        this.name = name;
        this.description = description ?? '';
        this.price = price;
        this.clubId = clubId;
        this.stock = stock ?? 0;
        this.type = 'APPAREL';
        this.availableSizes = availableSizes;

        Object.assign(this, dynamicFields);
    }

    toData() {
        return { ...this };
    }
}
module.exports = Apparel;