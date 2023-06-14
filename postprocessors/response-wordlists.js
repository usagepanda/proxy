import helpers from '../helpers.js';

// x-usagepanda-response-wordlists: profanity:block,dan:redact,custom:audit
const validWordlists = ['profanity', 'adult', 'dan', 'custom'];
const validWordlistActions = ['audit', 'block', 'redact'];

export default {
    header: 'x-usagepanda-response-wordlists',
    config: 'POLICY_RESPONSE_WORDLIST',
    run: async function(value, request, response, config, stats) {
        // Skip this check for non-supported endpoints
        if (['/v1/completions', '/v1/chat/completions'].indexOf(stats.endpoint) === -1) return;
        if (!value || !value.length) return;

        const wordlists = value.split(',');
        if (!wordlists.length) return;

        helpers.log.debug('Checking response wordlists');
        
        // Extract the prompt and compare the text with wordlists
        let respMatchedWordlists = [];

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
                if (response.choices) {
                    helpers.log.debug(`Checking wordlist for chat response: ${wlName}`);
                    response.choices.forEach(function(m){                        
                        if (m.text) {
                            // Completion
                            const {matched, newString} = helpers.matchesWordlist(wlName, m.text, passCustomList);
                            if (matched) {
                                respMatchedWordlists.push(wlName);
                                if (wlAction == 'redact') m.text = newString;
                                if (wlAction == 'block') stats.error = true;
                            }
                        } else if (m.message && m.message.content) {
                            // Chat Completion
                            const {matched, newString} = helpers.matchesWordlist(wlName, m.message.content, passCustomList);
                            if (matched) {
                                respMatchedWordlists.push(wlName);
                                if (wlAction == 'redact') m.message.content = newString;
                                if (wlAction == 'block') stats.error = true;
                            }
                        }
                        
                    });
                }
            }
        });
        
        // Block (error) or flag, depending on "action"
        if (respMatchedWordlists.length) {
            // config.wordlist_index comes from earlier when we inserted the request flags
            // If it isn't set, append flags
            let wlDescription = `Response matched known wordlists: ${respMatchedWordlists.join(', ')}`;
            if (config.wordlist_index) {
                stats.flags[config.wordlist_index].description += ('; ' + wlDescription);
            } else {
                stats.flags.push({
                    type: 'policy_wordlists',
                    description: wlDescription
                });
            }
        }
    }
};