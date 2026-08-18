// Builder Pattern — assembles a complex profile object step by step
// Each setter returns `this` so calls can be chained fluently

class StudentProfileBuilder {
    constructor() {
        this.profile = {};
    }

    setName(full_name) {
        this.profile.full_name = full_name;
        return this;
    }

    setPhone(phone) {
        this.profile.phone = phone;
        return this;
    }

    setHostelBlock(hostel_block) {
        this.profile.hostel_block = hostel_block;
        return this;
    }

    setPrefferedSize(preferred_size) {
        const VALID_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
        if (!VALID_SIZES.includes(preferred_size)) {
            throw new Error(`Invalid size. Valid sizes are : ${VALID_SIZES.join(', ')}`);
        }

        this.profile.preferred_size = preferred_size;
        return this;
    }

    build() {
        return { ...this.profile };
    }
}

module.exports = StudentProfileBuilder;