import helpers from '../helpers.js';

function getSubstringBetweenDelimiters(str, delimiter) {
    const startIndex = str.indexOf(delimiter);
    const endIndex = str.lastIndexOf(delimiter);
    
    if (startIndex === -1 || endIndex === -1 || startIndex === endIndex) {
        return false;
    }
    
    return str.substring(startIndex + delimiter.length, endIndex).trim();
}

export default {
    header: 'x-usagepanda-prompt-reflection',
    config: 'POLICY_PROMPT_REFLECTION',
    run: function(value, request, response, config, stats) {
        if (!value || value == 'none') return;
        // Skip this check for non-supported endpoints
        if (['/v1/completions', '/v1/chat/completions'].indexOf(stats.endpoint) === -1) return;

        if (response.choices) {
            helpers.log.debug(`Checking response for prompt reflection: ${value}`);
            
            let flagged = false;
            response.choices.forEach(function(c){
                if (c.text) {
                    // Completion
                    // Extract prompt from request using delimeter
                    const promptToCheck = getSubstringBetweenDelimiters(request.prompt, config.PROMPT_REFLECTION_DELIMETER);
                    if (promptToCheck) {
                        const reg = new RegExp(promptToCheck, 'ig');
                        if (c.text.match(reg)) {
                            if (value == 'redact') c.text = c.text.replace(reg, config.REDACTION_STRING);
                            if (value == 'block') stats.error = true;
                            flagged = true;
                        }
                    }
                } else if (c.message && c.message.content) {
                    // Chat Completion
                    // Loop through / check each of the input strings
                    request.messages.forEach(function(r){
                        if (r.role == 'system') {
                            const promptToCheck = getSubstringBetweenDelimiters(r.content, config.PROMPT_REFLECTION_DELIMETER);
                            if (promptToCheck) {
                                const reg = new RegExp(promptToCheck, 'ig');
                                if (c.message.content.match(reg)) {
                                    if (value == 'redact') c.message.content = c.message.content.replace(reg, config.REDACTION_STRING);
                                    if (value == 'block') stats.error = true;
                                    flagged = true;
                                }
                            }
                        }
                    });
                }
            });

            if (flagged) {
                stats.flags.push({
                    type: 'policy_prompt_reflection',
                    description: 'The response contained a reflection of the original prompt'
                });
            }
        }
    }
};