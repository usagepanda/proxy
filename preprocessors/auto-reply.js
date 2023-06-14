import helpers from '../helpers.js';

export default {
    header: 'x-usagepanda-auto-reply',
    run: async function(value, request, config, stats) {
        // Skip this check for non-supported endpoints
        if (['/v1/completions', '/v1/chat/completions'].indexOf(stats.endpoint) === -1) return;
        if (!config.POLICY_AUTOREPLY || !config.POLICY_AUTOREPLY.length) return;

        helpers.log.debug('Checking autoreplies');

        let userInput;
        if (request.prompt) {
            userInput = request.prompt;
        } else if (request.messages && request.messages.length) {
            userInput = request.messages[request.messages.length - 1].content;
        }

        if (!userInput) return;
        
        for (let i = 0; i < config.POLICY_AUTOREPLY.length; i++) {
            const ar = config.POLICY_AUTOREPLY[i];
            if (ar.request == userInput) {  // TODO: better regex matching
                // TODO: other condition matching here (e.g., condition_user)
                if (ar.type == 'chat' && stats.endpoint == '/v1/chat/completions') {
                    // Match; simulate OpenAI response
                    stats.flags.push({
                        type: 'policy_autoreply',
                        description: `Request matched known chat autoreply`
                    });
                    const response = helpers.rtnChatCompletion(request.model, ar.response);
                    stats.response = response.body;
                    return response;
                } else if (ar.type == 'completion' && stats.endpoint == '/v1/completions') {
                    // Match; simulate OpenAI response
                    stats.flags.push({
                        type: 'policy_autoreply',
                        description: `Request matched known completion autoreply`
                    });
                    const response = helpers.rtnCompletion(request.model, ar.response);
                    stats.response = response.body;
                    return response;
                }
            }
        }
    }
};