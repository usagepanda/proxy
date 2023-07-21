import helpers from './helpers.js';
import converters from './converters/index.js';
import preprocessors from './preprocessors/index.js';
import postprocessors from './postprocessors/index.js';
import { createHmac } from 'crypto';
import tiktoken from 'tiktoken-node';

const handler = awslambda.streamifyResponse(
    async (event, responseStream, _context) => {
        // If the event is from a scheduled event, retrieve the config and return
        // TODO: This does not work properly, we can't seem to end the streamifyResponse with event triggers
        if(event.source == 'aws.events') {
            for (const usagePandaKey of event.message.usagePandaKeys) {
                helpers.log.debug(`Updating config for ${usagePandaKey}`)
                await helpers.retrieveConfig(usagePandaKey);
            }
            // This results in a socket hangup error
            // responseStream.destroy()
            return
        }

        /****************************
         Initial Proxy Function Setup
        ****************************/
        // Handle CORS
        const processOptions = helpers.processOptions(event);
        if (processOptions) return processOptions;
        helpers.log.debug(`Received new proxy call: ${event.requestContext.http.method} ${event.requestContext.http.path}`);

        // Extract the Usage Panda key from the auth header
        const {headerError, openAIKey, usagePandaKey, customAuth} = helpers.extractHeaders(event);
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
            request: body,
            metadata: {
                proxy_id: config.PROXY_ID,
                ip_address: event.headers['x-forwarded-for'] || event.requestContext.identity.sourceIp,
                user_agent: event.headers['user-agent'],
                organization: event.headers['openai-organization'],
                trace_id: event.headers[(config.TRACE_HEADER || 'x-usagepanda-trace-id')],
            }
        };

        // // Loop through the preprocessors
        // for (let p = 0; p < preprocessors.length; p++) {
        //     const processor = preprocessors[p];
        //     const value = helpers.extractHeaderConfig(event.headers, config, processor);
        //     const pResponse = await processor.run(value, body, config, stats, options);
        //     if (pResponse) {
        //         helpers.log.debug(`Received preprocessor response for ${processor.header}. Returning.`);
        //         await uploadStats(stats);
        //         return pResponse;
        //     }
        // }

        // Error if flags with error
        // if (stats.error) {
        //     const rtnError = helpers.rtnError(422, 'invalid_request', `Usage Panda: ${stats.flags.map(function(f){return f.description}).join(', ')}`);
        //     stats.response = rtnError.body;
        //     await uploadStats(stats);
        //     return rtnError;
        // }

        options.json = body;

        // Check for API conversions (e.g., OpenAI --> PaLM)
        // pc = post-conversion
        const convertedReq = converters.request(endpoint, event.headers, options.json, config, stats);
        const pcUrl = convertedReq.url || url;
        const pcOptions = convertedReq.options || options;
        
        helpers.log.debug(`Sending ${method} request to ${pcUrl}`);
        const startTime = new Date();
        
        // Make LLM Request
        if (body['stream']) {
            const normalizedResponse = {
                id: "",
                object: "chat.completion",
                created: 0,
                model: "",
                choices: [
                    {index: 0, message: { role: "assistant", content: ""}, finish_reason: ""}
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            }
    
            let streamedBody = '';
            let responseHeaders = {};

            let llmHeaders;
            let incomplete = "";
            const startTime = new Date();
            for await (const dataStream of helpers.makeLLMStreamRequest(method, pcUrl, pcOptions)) {
                if (!llmHeaders) {
                    llmHeaders = dataStream.headers;

                    llmHeaders['Content-Type'] = 'text/event-stream';
                    llmHeaders['Cache-Control'] = 'no-cache';
                    llmHeaders['Connection'] = 'keep-alive';
        
        
                    const httpResponseMetadata = {
                        statusCode: 200,
                        headers: llmHeaders,
                    };
    
                    responseStream = awslambda.HttpResponseStream.from(responseStream, httpResponseMetadata);
                }
                responseStream.write(dataStream.body)

                if (incomplete) {
                    helpers.log.debug(`Merging ${incomplete} with ${dataStream.body}`)
                    dataStream.body = incomplete + dataStream.body;
                    incomplete = "";
                }

                const extractData = (match) => match[1];
                let responseData = Array.from(dataStream.body.matchAll(/^data: (.*)$/mg), extractData);
                let lastIndex = responseData[responseData.length - 1]

                // Chunks occasionally come incomplete, and are sent in the next chunk.
                // Validate the data is valid JSON, otherwise pop the last element
                // and save it for the next iteration.
                try {
                    JSON.parse(lastIndex);
                } catch (e) {
                    helpers.log.debug('Streamed body cut off. Saving for next iteration.')
                    incomplete = responseData.pop()
                }

                for (let data of responseData) {
                    if (data == "[DONE]") {
                        responseStream.write(data)
                        responseStream.end()
                        break
                    }

                    let llmResponse = JSON.parse(data)
                    let llmChoice = llmResponse['choices'][0]

                    // Constructing an object that represents a non-streaming OpenAI response
                    normalizedResponse['id'] = llmResponse['id']
                    normalizedResponse['created'] = llmResponse['created']
                    normalizedResponse['model'] = llmResponse['model']

                    // There are a number of "finished_reasons"
                    // stop: API returned complete message, or a message terminated by one of the stop sequences provided via the stop parameter
                    // length: Incomplete model output due to max_tokens parameter or token limit
                    // function_call: The model decided to call a function
                    // content_filter: Omitted content due to a flag from our content filters
                    // null: API response still in progress or incomplete
                    if (llmChoice['finish_reason'] != null){
                        normalizedResponse['choices'][0]['finish_reason'] = llmChoice['finish_reason']
                    }

                    streamedBody +=  llmChoice['delta']['content'] || '';
                    normalizedResponse['choices'][0]['message']['content'] = streamedBody

                    
                }

                // Since we're streaming, we will incrementally scan the response messages
                // We do it after the latest set of chunks to call it less
                // If a block is detected, interrupt the stream? Return an error in the stream?
                for (let p = 0; p < postprocessors.length; p++) {
                    const processor = postprocessors[p];
                    const value = helpers.extractHeaderConfig(event.headers, config, processor);
                    const pResponse = await processor.run(value, body, normalizedResponse, config, stats);
                    if (pResponse) {
                        await uploadStats(stats);
                        responseStream.end()
                    }
                }
            }

            const endTime = new Date();
            // Calculate the number of tokens used
            // TODO: Not sure how heavy loading these token mappings are, we should pre-load them
            const tokenEncoder = tiktoken.encodingForModel(normalizedResponse['model'])
            normalizedResponse['usage']['prompt_tokens'] = body['messages'].reduce((count, message) => count + tokenEncoder.encode(message.content).length, 0);
            normalizedResponse['usage']['completion_tokens'] = tokenEncoder.encode(streamedBody).length
            normalizedResponse['usage']['total_tokens'] = normalizedResponse['usage']['prompt_tokens'] + normalizedResponse['usage']['completion_tokens']
            stats.metadata.latency = (endTime.getTime() - startTime.getTime());
            stats.response = normalizedResponse;
            await uploadStats(stats);

        } else {

            const response = await helpers.makeLLMRequest(method, pcUrl, pcOptions);
            const endTime = new Date();
            stats.metadata.latency = (endTime.getTime() - startTime.getTime());

            const httpResponseMetadata = {
                statusCode: 200,
                headers: response.headers,
            };
            
            responseStream = awslambda.HttpResponseStream.from(responseStream, httpResponseMetadata);

            // Check for API conversions (e.g., PaLM --> OpenAI)
            // pc = post-conversion
            const convertedBody = converters.response(endpoint, event.headers, options.json, response.body, config, stats);
            if (convertedBody) response.body = convertedBody;


            if (response.body && response.body.error) {
                helpers.log.error(response.body.error);
                stats.error = true;
                stats.response = response.body;
                responseStream.write(response.body);
                responseStream.end();
                uploadStats(stats);
            } else {
                helpers.log.debug(`Returning ${response.statusCode} response`);
                stats.response = response.body;
                responseStream.write(response.body);
                responseStream.end();
                uploadStats(stats);
            }

            // Loop through the postprocessors
            // for (let p = 0; p < postprocessors.length; p++) {
            //     const processor = postprocessors[p];
            //     const value = helpers.extractHeaderConfig(event.headers, config, processor);
            //     const pResponse = await processor.run(value, body, response.body, config, stats);
            //     if (pResponse) {
            //         uploadStats(stats);
            //         return pResponse;
            //     }
            // }
            // Error if flags with error (again, after processing response)
            if (stats.error) {    
                const rtnError = helpers.rtnError(422, 'invalid_request', `Usage Panda: ${stats.flags.map(function(f){return f.description}).join(', ')}`);
                stats.response = rtnError.body;
                return rtnError;
            }
        }
        responseStream.end();
    }
);


export { handler as handler };
