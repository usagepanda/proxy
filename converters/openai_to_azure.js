// Converts API requests from OpenAI to Azure's OpenAI

import helpers from '../helpers.js';

export default {
    request: {
        '/v1/completions': function(azureApiKey, azureResource, azureDeployment, body, azureApiVersion) {
            const apiVersion = azureApiVersion || '2023-05-15';
            const newUrl = `https://${azureResource}.openai.azure.com/openai/deployments/${azureDeployment}/completions?api-version=${apiVersion}`;

            helpers.log.debug(`Converting /completions to new Azure format.`);

            return {
                url: newUrl,
                options: {
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': azureApiKey.split(' ')[1]    // Azure's API expects just the key without the "Bearer"
                    },
                    json: body
                }
            };
        },
        '/v1/chat/completions': function(azureApiKey, azureResource, azureDeployment, body, azureApiVersion) {
            const apiVersion = azureApiVersion || '2023-05-15';
            const newUrl = `https://${azureResource}.openai.azure.com/openai/deployments/${azureDeployment}/chat/completions?api-version=${apiVersion}`;

            helpers.log.debug(`Converting /chat/completions to new Azure format.`);

            return {
                url: newUrl,
                options: {
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': azureApiKey.split(' ')[1]    // Azure's API expects just the key without the "Bearer"
                    },
                    json: body
                }
            };
        },
        '/v1/embeddings': function(azureApiKey, azureResource, azureDeployment, body, azureApiVersion) {
            const apiVersion = azureApiVersion || '2023-05-15';
            const newUrl = `https://${azureResource}.openai.azure.com/openai/deployments/${azureDeployment}/embeddings?api-version=${apiVersion}`;

            helpers.log.debug(`Converting /embeddings to new Azure format.`);

            return {
                url: newUrl,
                options: {
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': azureApiKey.split(' ')[1]    // Azure's API expects just the key without the "Bearer"
                    },
                    json: body
                }
            };
        }
    },
    response: {

    }
};