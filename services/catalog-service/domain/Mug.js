class Mug {
    constructor(payload) {
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
        this.type = 'MUG';

        // Mugs never have sizes
        this.availableSizes = [];

        // Add all additional dynamic fields
        Object.assign(this, dynamicFields);
    }

    toData() {
        return { ...this };
    }
}

module.exports = Mug;