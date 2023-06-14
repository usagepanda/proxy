import helpers from '../helpers.js';

export default {
    header: 'x-usagepanda-max-prompt-chars',
    config: 'POLICY_MAX_PROMPT_CHARS',
    run: function(value, request, config, stats) {
        // Skip this check for non-supported endpoints
        if (['/v1/completions', '/v1/chat/completions', '/v1/edits'].indexOf(stats.endpoint) === -1) return;

        if (!value || !parseInt(value)) return;
        const maxPromptChars = parseInt(value);

        let promptLength = 0;
        if (stats.endpoint == '/v1/completions' && request.prompt) {
            promptLength = request.prompt.length;
        } else if (stats.endpoint == '/v1/chat/completions'  && request.messages) {
            // Loop through messages to calculate total size
            request.messages.forEach(function(m){
                promptLength += m.content.length;
            });
        } else if (stats.endpoint == '/v1/edits' && request.input) {
            promptLength = request.input.length;
        }
        
        helpers.log.warn(`Config set to max prompt chars of: ${maxPromptChars}; prompt was: ${promptLength}`);
        if (promptLength > maxPromptChars) {
            stats.error = true;
            stats.flags.push({
                type: 'policy_max_prompt_chars',
                description: `Config set to max prompt chars of: ${maxPromptChars}; prompt was: ${promptLength}`
            });
        }
    }
};