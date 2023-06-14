import helpers from '../helpers.js';

export default {
    run: function(value, request, config, stats) {        
        if (config.POLICY_DISABLED_MODELS && config.POLICY_DISABLED_MODELS.length) {
            if (request.model && config.POLICY_DISABLED_MODELS.includes(request.model)) {
                helpers.log.warn(`Config set to block usage of model: ${request.model}`);
                stats.error = true;
                stats.flags.push({
                    type: 'policy_disabled_models',
                    description: `Config set to block usage of model: ${request.model}`
                });
            } else if (request.size && config.POLICY_DISABLED_MODELS.includes(request.size)) {
                helpers.log.warn(`Config set to block usage of image generation size: ${request.size}`);
                stats.error = true;
                stats.flags.push({
                    type: 'policy_disabled_models',
                    description: `Config set to block usage of image generation size: ${request.size}`
                });
            }
        }
    }
};