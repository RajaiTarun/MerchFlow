const axios = require('axios');

const sleep = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

// Default to 'localhost' for plain local `npm run dev`; Docker Compose
// overrides this to the catalog-service container name.
const CATALOG_SERVICE_HOST = process.env.CATALOG_SERVICE_HOST || 'localhost';

async function compensateInventory({
    catalogItemId,
    reservationId,
    internalHeaders
}) {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            console.log(
                `[ORDER SERVICE] Compensation attempt ${attempt}/${MAX_ATTEMPTS}: reservation=${reservationId}`
            );

            const response = await axios.patch(
                `http://${CATALOG_SERVICE_HOST}:${process.env.CATALOG_SERVICE_PORT || 3002}/${catalogItemId}/rollback`,
                {
                    reservationId
                },
                {
                    headers: internalHeaders,
                    timeout: 3000
                }
            );

            console.log(
                `[ORDER SERVICE] Compensation successful: reservation=${reservationId}, alreadyCompensated=${response.data.alreadyCompensated}`
            );

            return {
                success: true,
                alreadyCompensated: response.data.alreadyCompensated
            };

        } catch (err) {
            console.error(
                `[ORDER SERVICE] Compensation attempt ${attempt} failed:`,
                err.message
            );

            if (attempt === MAX_ATTEMPTS) {
                break;
            }

            // 100ms, 200ms before next attempt
            await sleep(attempt * 100);
        }
    }

    return {
        success: false
    };
}

module.exports = compensateInventory;