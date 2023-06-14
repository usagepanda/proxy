// Converts API requests from Google's PaLM to OpenAI

import helpers from '../helpers.js';

// TODO: should we just not convert the model? Safe to send back a PaLM model to OpenAI request?

export default {
    request: {
        
    },
    response: {
        '/v1/completions': function(reqBody, respBody) {
            // https://developers.generativeai.google/api/rest/generativelanguage/models/generateText
            // https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generateText?key=$PALM_API_KEY

            // TODO: create a model map once more models are available on PaLM
            const models = {
                default: 'text-davinci-003'
            };

            helpers.log.debug(`Converting response from PaLM to OpenAI /completions format.`);
            helpers.log.debug(respBody);

            if (!respBody || !respBody.candidates || !respBody.candidates.length) {
                return {
                    error: {
                        message: 'The response from PaLM did not contain any valid candidates',
                        type: 'palm_no_candidates',
                        param: null,
                        code: null
                    }
                }
            }

            return {
                id: 'cmpl-up',
                object: 'text_completion',
                created: Math.floor(Date.now()/1000),
                model: models[reqBody.model] ? models[reqBody.model] : models.default,
                choices: respBody.candidates.map(function(candidate, index){
                    return {
                        text: candidate.output,
                        index: index,
                        logprobs: null,
                        finish_reason: 'stop'
                    };
                }),
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };
        },
        '/v1/chat/completions': function(reqBody, respBody) {
            // https://developers.generativeai.google/api/rest/generativelanguage/models/generateMessage
            // https://autopush-generativelanguage.sandbox.googleapis.com/v1beta2/models/chat-bison-001:generateMessage?key=$PALM_API_KEY

            // TODO: create a model map once more models are available on PaLM
            const models = {
                default: 'gpt-3.5-turbo'
            };

            helpers.log.debug(`Converting response from PalM to OpenAI /chat/completions format.`);
            helpers.log.debug(respBody);

            if (!respBody || !respBody.candidates || !respBody.candidates.length) {
                return {
                    error: {
                        message: 'The response from PaLM did not contain any valid candidates',
                        type: 'palm_no_candidates',
                        param: null,
                        code: null
                    }
                }
            }

            return {
                id: 'chatcmpl-up',
                object: 'chat.completion',
                created: Math.floor(Date.now()/1000),
                // OpenAI does not include the "model" in this response
                // model: models[reqBody.model] ? models[reqBody.model] : models.default,
                choices: respBody.candidates.map(function(candidate, index){
                    return {
                        index: index,
                        message: {
                            role: candidate.author,
                            content: candidate.content
                        },
                        finish_reason: 'stop'
                    };
                }),
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };
        }
    }
};