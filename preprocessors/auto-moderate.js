import helpers from '../helpers.js';

export default {
    header: 'x-usagepanda-auto-moderate',
    config: 'POLICY_AUTO_MODERATE',
    run: async function(value, request, config, stats) {
        // Skip this check for non-supported endpoints
        if (['/v1/completions', '/v1/chat/completions', '/v1/edits'].indexOf(stats.endpoint) === -1) return;

        if (!value || value !== 'true') return;

        let userGeneratedContent = '';
        if (stats.endpoint == '/v1/completions' && request.prompt) {
            userGeneratedContent = request.prompt;
        } else if (stats.endpoint == '/v1/chat/completions'  && request.messages) {
            // Loop through messages to calculate total size
            request.messages.forEach(function(m){
                userGeneratedContent += (' ' + m.content);
            });
        } else if (stats.endpoint == '/v1/edits' && request.input) {
            userGeneratedContent = request.input;
        }

        const url = `${config.LLM_API_BASE_PATH}/v1/moderations`;
        const options = {
            headers: { 'authorization': config.LOADED_OPENAI_API_KEY },
            json: {
                input: userGeneratedContent
            }
        };

        helpers.log.debug(`Auto-moderating request to ${stats.endpoint} endpoint`);
        const moderation = await helpers.makeLLMRequest('post', url, options);
        helpers.log.debug(`Moderation: ${moderation.statusCode} response`);
        helpers.log.debug(moderation.body);
        const moderated = moderation.body;

        if (moderated.results &&
            moderated.results[0] &&
            moderated.results[0].flagged) {
            let modReasons = [];
            Object.keys(moderated.results[0].categories).forEach(function(c){
                if (moderated.results[0].categories[c]) modReasons.push(c);
            });
            
            stats.error = true;
            stats.flags.push({
                type: 'policy_auto_moderate',
                description: `Moderation flagged this request: ${modReasons.join(', ')}`
            });
        }
    }
};