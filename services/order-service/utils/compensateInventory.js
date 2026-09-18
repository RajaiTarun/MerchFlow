const axios = require('axios');

const sleep = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

// Default to plain local process for `npm run dev`; Docker Compose overrides
// this to http://catalog-service:3002; Render overrides it to catalog-service's
// public URL (see the note in api-gateway/index.js on why).
const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://localhost:3002';

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
                `${CATALOG_SERVICE_URL}/${catalogItemId}/rollback`,
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