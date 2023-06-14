// Converts API requests from Azure to OpenAI

import helpers from '../helpers.js';

export default {
    request: {
        
    },
    response: {
        '/v1/completions': function(reqBody, respBody) {
            return respBody;
        },
        '/v1/chat/completions': function(reqBody, respBody) {
            return respBody;
        },
        '/v1/embeddings': function(reqBody, respBody) {
            return respBody;
        }
    }
};