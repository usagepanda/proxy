import helpers from '../helpers.js';

// x-usagepanda-request-wordlists: profanity:block,dan:redact,custom:audit
const validWordlists = ['profanity', 'adult', 'dan', 'custom'];
const validWordlistActions = ['audit', 'block', 'redact'];

export default {
    header: 'x-usagepanda-request-wordlists',
    config: 'POLICY_REQUEST_WORDLIST',
    run: async function(value, request, config, stats) {
        // Skip this check for non-supported endpoints
        if (['/v1/completions', '/v1/chat/completions'].indexOf(stats.endpoint) === -1) return;
        if (!value || !value.length) return;

        const wordlists = value.split(',');
        if (!wordlists.length) return;

        helpers.log.debug('Checking request wordlists');

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

        if (!userGeneratedContent) return;
        
        // Extract the prompt and compare the text with wordlists
        let reqMatchedWordlists = [];

        wordlists.forEach(function(wl){
            const wlSplit = wl.split(':');
            const wlName = wlSplit[0];
            const wlAction = wlSplit[1];

            if (!validWordlistActions.includes(wlAction)) {
                helpers.log.warn(`Invalid wordlist action: ${wlAction} for wordlist: ${wlName}`);
            } else if (!validWordlists.includes(wlName)) {
                helpers.log.warn(`Invalid wordlist: ${wlName}`);
            } else {
                const passCustomList = (wlName == 'custom') ? (config.policy_custom_wordlist || []) : null;
                if (request.prompt) {
                    helpers.log.debug(`Checking wordlist for prompt request: ${wlName}`);
                    const {matched, newString} = helpers.matchesWordlist(wlName, request.prompt, passCustomList);
                    if (matched) {
                        reqMatchedWordlists.push(wlName);
                        if (wlAction == 'redact') request.prompt = newString;
                        if (wlAction == 'block') stats.error = true;
                    }
                } else if (request.messages) {
                    helpers.log.debug(`Checking wordlist for chat request: ${wlName}`);
                    request.messages.forEach(function(m){
                        const {matched, newString} = helpers.matchesWordlist(wlName, m.content, passCustomList);
                        if (matched) {
                            reqMatchedWordlists.push(wlName);
                            if (wlAction == 'redact') m.content = newString;
                            if (wlAction == 'block') stats.error = true;
                        }
                    });
                }
            }
        });
        
        // Block (error) or flag, depending on "action"
        if (reqMatchedWordlists.length) {
            stats.flags.push({
                type: 'policy_wordlists',
                description: `Request matched known wordlists: ${reqMatchedWordlists.join(', ')}`
            });
            config.wordlist_index = stats.flags.length - 1;
        }
    }
};