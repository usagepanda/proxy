import helpers from './helpers.js';
import converters from './converters/index.js';
import preprocessors from './preprocessors/index.js';
import postprocessors from './postprocessors/index.js';
import { createHmac } from 'crypto';

export async function handler (event, context) {
    /****************************
     Initial Proxy Function Setup
    ****************************/
    // Handle CORS
    const processOptions = helpers.processOptions(event);
    if (processOptions) return processOptions;
    
    helpers.log.debug(`Received new proxy call: ${event.requestContext.http.method} ${event.requestContext.http.path}`);
    helpers.log.debug(event);

    // Extract the Usage Panda key from the auth header
    const {headerError, openAIKey, usagePandaKey} = helpers.extractHeaders(event);
    if (headerError) return headerError;

    // Load the config; cache it
    const {configError, config, configLoadedFromCache} = await helpers.loadConfig(usagePandaKey);
    if (configError && (!config || !config.FAIL_OPEN_ON_CONFIG_ERROR)) return configError;

    helpers.log.debug('Final merged config:');
    helpers.log.debug(config);

    // Temp fix for /v1/ prefix
    if (event.requestContext.http.path.toLowerCase().indexOf('/v1') !== 0) {
        helpers.log.debug('Prepending /v1 path prefix');
        event.requestContext.http.path = `/v1${event.requestContext.http.path}`;
    }
    if (config.LLM_API_BASE_PATH == 'https://api.openai.com/v1') config.LLM_API_BASE_PATH = 'https://api.openai.com';

    const method = event.requestContext.http.method.toLowerCase();
    const endpoint = event.requestContext.http.path.toLowerCase();
    const url = `${config.LLM_API_BASE_PATH}${endpoint}`;
    const options = { headers: { 'authorization': openAIKey } };

    // If OpenAI Org header was passed in, ensure it is passed to OpenAI
    if (event.headers['openai-organization']) options.headers['OpenAI-Organization'] = event.headers['openai-organization'];

    // Append OpenAI key to config in case we need to make middleware requests
    config.LOADED_OPENAI_API_KEY = openAIKey;

    // If the request is not a POST request, simply proxy it and return
    if (method !== 'post') {
        helpers.log.debug(`Proxy pass-through for non-POST endpoint: ${endpoint}`);
        // TODO: process request for other LLM providers (Azure?)
        return await helpers.makeLLMRequest(method, url, options);
    }

    // Ensure body is JSON
    // TODO: try/catch this
    const body = JSON.parse(event.body);

    // If the user field exists in the body and we have user masking enabled,
    // pseudonymize it via HMAC so that's it's consistent in logs across this proxy ID.
    if (config.MASK_USER_FIELD && body['user']) {
        body['user'] = createHmac('sha256', config.PROXY_ID)
            .update(body['user'])
            .digest('hex')
            .slice(0, 16);
    }

    // Check if the client sent a streaming field, and disable it if it's not allowed
    if (body['stream'] && !config.ALLOW_STREAMING) {
        body['stream'] = false;
    }

    // Define the uploadStats function
    const uploadStats = helpers.uploadStats(method, url, usagePandaKey);

    /****************************
     Proxy Logic
    ****************************/
    // Collect stats about the request to send to Usage Panda
    const stats = {
        endpoint: event.requestContext.http.path,
        config_cached: configLoadedFromCache,
        flags: [],
        error: false,
        autorouted: {},
        metadata: {
            proxy_id: config.PROXY_ID,
            ip_address: event.requestContext.http.sourceIp,
            user_agent: event.requestContext.http.userAgent,
            organization: event.headers['openai-organization'],
            trace_id: event.headers[(config.TRACE_HEADER || 'x-usagepanda-trace-id')],
        }
    };

    // Loop through the preprocessors
    for (let p = 0; p < preprocessors.length; p++) {
        const processor = preprocessors[p];
        const value = helpers.extractHeaderConfig(event.headers, config, processor);
        const pResponse = await processor.run(value, body, config, stats, options);
        if (pResponse) {
            helpers.log.debug(`Received preprocessor response for ${processor.header}. Returning.`);
            await uploadStats(stats);
            return pResponse;
        }
    }

    // Error if flags with error
    if (stats.error) {
        const rtnError = helpers.rtnError(422, 'invalid_request', `Usage Panda: ${stats.flags.map(function(f){return f.description}).join(', ')}`);
        stats.response = rtnError.body;
        await uploadStats(stats);
        return rtnError;
    }

    options.json = body;

    // Check for API conversions (e.g., OpenAI --> PaLM)
    // pc = post-conversion
    const convertedReq = converters.request(endpoint, event.headers, options.json, config, stats);
    const pcUrl = convertedReq.url || url;
    const pcOptions = convertedReq.options || options;
    
    helpers.log.debug(`Sending ${method} request to ${pcUrl}`);
    const startTime = new Date();
    const response = await helpers.makeLLMRequest(method, pcUrl, pcOptions);
    const endTime = new Date();
    stats.metadata.latency = (endTime.getTime() - startTime.getTime());

    // Check for API conversions (e.g., PaLM --> OpenAI)
    // pc = post-conversion
    const convertedBody = converters.response(endpoint, event.headers, options.json, response.body, config, stats);
    if (convertedBody) response.body = convertedBody;

    if (response.body && response.body.error) {
        helpers.log.error(response.body.error);
        stats.error = true;
        stats.response = response.body;
        await uploadStats(stats);
        return response;
    }
    
    // Loop through the postprocessors
    for (let p = 0; p < postprocessors.length; p++) {
        const processor = postprocessors[p];
        const value = helpers.extractHeaderConfig(event.headers, config, processor);
        const pResponse = await processor.run(value, body, response.body, config, stats);
        if (pResponse) {
            await uploadStats(stats);
            return pResponse;
        }
    }

    await uploadStats(stats);

    // Error if flags with error (again, after processing response)
    if (stats.error) {    
        const rtnError = helpers.rtnError(422, 'invalid_request', `Usage Panda: ${stats.flags.map(function(f){return f.description}).join(', ')}`);
        stats.response = rtnError.body;
        return rtnError;
    }

    helpers.log.debug(`Returning ${response.statusCode} response`);
    return response;
};