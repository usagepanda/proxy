import helpers from '../helpers.js';

export default {
    header: 'x-usagepanda-enforce-user-ids',
    config: 'POLICY_ENFORCE_USER_IDS',
    run: function(value, request, config, stats) {
        // Skip this check for non-supported endpoints
        if (['/v1/completions', '/v1/chat/completions', '/v1/images/generations',
            '/v1/images/edits', '/v1/images/variations', '/v1/embeddings'].indexOf(stats.endpoint) === -1) return;

        if (!value || value !== 'true') return;

        if (!request.user) {
            helpers.log.warn(`Config set to block requests without user field`);
            stats.error = true;
            stats.flags.push({
                type: 'policy_enforce_user_ids',
                description: `Config set to block requests without user field`
            });
        }
    }
};