import helpers from '../helpers.js';

export default {
    header: 'x-usagepanda-retry-count',
    config: 'POLICY_RETRY_COUNT',
    run: async function(value, request, config, stats, options) {
        let retryCount = parseInt(value);
        if (!retryCount) return;

        if (retryCount > 5) {
            helpers.log.warn(`Retry count of: ${retryCount} is above max allowed of 5. Set to: 5.`);
            retryCount = 5;
        } else {
            helpers.log.debug(`Retry count set to: ${retryCount}.`);
        }
        
        // Inject retry count to options
        // TODO: possibly add backoff: https://github.com/sindresorhus/got/blob/main/documentation/7-retry.md
        options.retry = {
            methods: ['GET', 'POST'],
            limit: retryCount
        };
    }
};