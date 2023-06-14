// Converts API requests from OpenAI to Google's PaLM

import helpers from '../helpers.js';

export default {
    request: {
        '/v1/completions': function(apikey, body) {
            // https://developers.generativeai.google/api/rest/generativelanguage/models/generateText
            // https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generateText?key=$PALM_API_KEY
            // TODO: create a model map once more models are available on PaLM
            const models = {
                default: 'text-bison-001'
            };
            
            const newBody = {
                prompt: {
                    text: body.prompt
                },
                temperature: body.temperature,
                candidateCount: body.n || 1,
                maxOutputTokens: body.max_tokens,
                topP: body.top_p,
                stopSequences: (body.stop ? (Array.isArray(body.stop) ? body.stop : [body.stop]) : null),
                // topK: 0 (not supported by OpenAI)
            };

            const model = models[body.model] ? models[body.model] : models.default;
            const newUrl = `https://generativelanguage.googleapis.com/v1beta2/models/${model}:generateText?key=${apikey}`;

            helpers.log.debug(`Converting /completions to new PaLM format.`);
            helpers.log.debug(newBody);

            return {
                url: newUrl,
                options: {
                    json: newBody
                }
            };
        },
        '/v1/chat/completions': function(apikey, body) {
            // https://developers.generativeai.google/api/rest/generativelanguage/models/generateMessage
            // https://autopush-generativelanguage.sandbox.googleapis.com/v1beta2/models/chat-bison-001:generateMessage?key=$PALM_API_KEY

            if (!body.messages || !body.messages.length) return {};
            
            // TODO: create a model map once more models are available on PaLM
            const models = {
                default: 'chat-bison-001'
            };

            const newBody = {
                prompt: {
                    messages: body.messages.map(function(m){
                        return {
                            author: m.role,
                            content: m.content
                        }
                    })
                },
                temperature: body.temperature,
                candidateCount: body.n || 1,
                // maxOutputTokens: body.max_tokens, (not supported by PaLM)
                topP: body.top_p,
                // topK: 0 (not supported by OpenAI)
            };

            const model = models[body.model] ? models[body.model] : models.default;
            const newUrl = `https://generativelanguage.googleapis.com/v1beta2/models/${model}:generateMessage?key=${apikey}`;
            // https://generativelanguage.googleapis.com/v1beta2/{model=models/*}:generateMessage

            helpers.log.debug(`Converting /chat/completions to new PaLM format.`);
            helpers.log.debug(newBody);

            return {
                url: newUrl,
                options: {
                    json: newBody
                }
            };
        }
    },
    response: {

    }
};