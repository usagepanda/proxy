import helpers from '../helpers.js';

export default {
    header: 'x-usagepanda-max-tokens',
    config: 'POLICY_MAX_TOKENS',
    run: function(value, request, config, stats) {
        // Skip this check for non-supported endpoints
        if (['/v1/completions', '/v1/chat/completions'].indexOf(stats.endpoint) === -1) return;

        if (!value || !parseInt(value)) return;
        const maxTokens = parseInt(value);
        
        helpers.log.warn(`Config set to max tokens of: ${maxTokens}; request was: ${request.max_tokens}`);
        
        if (!request.max_tokens || request.max_tokens > maxTokens) {
            stats.error = true;
            stats.flags.push({
                type: 'policy_max_tokens',
                description: `Config set to max tokens of: ${maxTokens}; request was: ${request.max_tokens}`
            });
        }
    }
};