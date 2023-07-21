import helpers from '../helpers.js';
import openaitopalm from './openai_to_palm.js';
import openaitoazure from './openai_to_azure.js';
import palmtoopenai from './palm_to_openai.js';
import azuretoopenai from './azure_to_openai.js';

export default {
    request: function convert(endpoint, headers, body, config, stats) {        
        const logRequest = helpers.extractHeaderConfig(headers, config, {header: 'x-usagepanda-log-request', config: 'POLICY_LOG_REQUEST'});
        
        // Use the headers to determine which conversion is happening
        if (headers['x-usagepanda-palm-api-key']) {
            if (!openaitopalm.request[endpoint]) {
                helpers.log.warn(`Conversion from OpenAI to PaLM request is not supported for the ${endpoint} endpoint. Failing open back to original request.`);
                return {};
            }

            // TODO: validate the headers['x-usagepanda-palm-api-key'] format
            
            // Converting to Google PaLM
            const newRequest = openaitopalm.request[endpoint](headers['x-usagepanda-palm-api-key'], body);
            if (logRequest && newRequest && newRequest.options && newRequest.options.json) {
                stats.autorouted.palm_request = newRequest.options.json;
            }
            return newRequest
        } else if (headers['x-usagepanda-azure-resource'] || config.AZURE_RESOURCE_NAME) {
            if (!openaitoazure.request[endpoint]) {
                helpers.log.warn(`Conversion from OpenAI to Azure request is not supported for the ${endpoint} endpoint. Failing open back to original request.`);
                return {};
            }

            // Load required Azure configs
            const azureApiKey = config.LOADED_OPENAI_API_KEY;
            const azureResource = helpers.extractHeaderConfig(headers, config, {header: 'x-usagepanda-azure-resource', config: 'AZURE_RESOURCE_NAME'});
            const azureDeploymentMap = helpers.extractHeaderConfig(headers, config, {config: 'AZURE_DEPLOYMENT_MAP'});

            if (!azureApiKey || !azureResource || !azureDeploymentMap || !Object.keys(azureDeploymentMap).length || !body.model) {
                helpers.log.warn(`Conversion from OpenAI to Azure request cannot be completed without a valid API key, resource, and deployment. Failing open back to original request.`);
                return {};
            }

            // Map model to an Azure deployment
            const azureDeployment = azureDeploymentMap[body.model];
            if (!azureDeployment) {
                helpers.log.warn(`Conversion from OpenAI to Azure request cannot be completed without a valid model to deployment mapping. ${body.model} is not defined in the map.`);
                return {};
            }
            
            // Converting to Azure
            const newRequest = openaitoazure.request[endpoint](azureApiKey, azureResource, azureDeployment, body, config.AZURE_API_VERSION);
            if (logRequest && newRequest && newRequest.options && newRequest.options.json) {
                stats.autorouted.azure_request = newRequest.options.json;
            }
            return newRequest;
        }

        // Default return {}
        return {};
    },
    response: function convert(endpoint, headers, reqBody, respBody, config, stats) {
        if (!respBody || respBody.error) return;

        const logResponse = helpers.extractHeaderConfig(headers, config, {header: 'x-usagepanda-log-response', config: 'POLICY_LOG_RESPONSE'});
        
        // Use the headers to determine which conversion is happening
        if (headers['x-usagepanda-palm-api-key']) {
            if (!palmtoopenai.response[endpoint]) {
                helpers.log.warn(`Conversion from PaLM to OpenAI response is not supported for the ${endpoint} endpoint. Failing open back to original request.`);
                return;
            }

            if (logResponse && respBody) {
                stats.autorouted.palm_response = respBody;
            }

            // TODO: validate the headers['x-usagepanda-palm-api-key'] format
            
            // Converting from Google PaLM to OpenAI response
            return palmtoopenai.response[endpoint](reqBody, respBody);
        } else if (headers['x-usagepanda-azure-resource'] || config.AZURE_RESOURCE_NAME) {
            if (!azuretoopenai.response[endpoint]) {
                helpers.log.warn(`Conversion from Azure to OpenAI response is not supported for the ${endpoint} endpoint. Failing open back to original request.`);
                return;
            }

            if (logResponse && respBody) {
                stats.autorouted.azure_response = respBody;
            }
            
            // Converting from Azure to OpenAI response
            return azuretoopenai.response[endpoint](reqBody, respBody);
        }

        return;
    }
};