'use strict';
import express from 'express';

// import * as lambda from './index.js'
import helpers from './helpers.js';
import config from './config.js';
import converters from './converters/index.js';
import preprocessors from './preprocessors/index.js';
import postprocessors from './postprocessors/index.js';

import bodyParser  from 'body-parser';
import tiktoken from 'tiktoken-node';
import { Readable, Transform } from 'stream'

import { parse } from 'url';
import { Console } from 'console';


const app = express();
const port = process.env.PORT || 9000; 

app.use(bodyParser.json());

app.post('/v1/chat/completions', async (req, res) => {
    // There are some helper functions that expect a Lambda event object
    let event = {};
    event = {
        headers: req.headers,
        requestContext: {
            http: {
                    method: req.method,
                    path: req.url
                },
            body: req.body
        }
    }

    // Extract the auth and Usage Panda key from the headers
    const {headerError, openAIKey, usagePandaKey} = helpers.extractHeaders(req);
    if (headerError) res.status(401).json(headerError.body).end();

    // Load the config; cache it
    const {configError, config, configLoadedFromCache} = await helpers.loadConfig(usagePandaKey);
    if (configError && (!config || !config.FAIL_OPEN_ON_CONFIG_ERROR)) res.status(401).json(configError);

    // Handle CORS
    const processOptions = helpers.processOptions(event);
    if (processOptions) {
        for (corsHeader in config.CORS_HEADERS) {
            res.header(corsHeader, config.CORS_HEADERS[corsHeader]);
        }
        res.status(processOptions['statusCode']).send(processOptions['body']).end()
    };

    helpers.log.debug(`Received new proxy call: ${req.method} ${req.path}`);

    // Temp fix for /v1/ prefix
    if (req.url.toLowerCase().indexOf('/v1') !== 0) {
        helpers.log.debug('Prepending /v1 path prefix');
        req.url = `/v1${req.url}`;
    }
    if (config.LLM_API_BASE_PATH == 'https://api.openai.com/v1') config.LLM_API_BASE_PATH = 'https://api.openai.com';

    const method = req.method.toLowerCase();
    const endpoint = req.url.toLowerCase();
    const url = `${config.LLM_API_BASE_PATH}${endpoint}`;
    const options = { headers: { 'authorization': openAIKey } };

    // If OpenAI Org header was passed in, ensure it is passed to OpenAI
    if (req.headers['openai-organization']) options.headers['OpenAI-Organization'] = req.headers['openai-organization'];

    // Append OpenAI key to config in case we need to make middleware requests
    config.LOADED_OPENAI_API_KEY = openAIKey;

    // If the user field exists in the body and we have user masking enabled,
    // pseudonymize it via HMAC so that's it's consistent in logs across this proxy ID.
    if (config.MASK_USER_FIELD && req.body['user']) {
        req.body['user'] = createHmac('sha256', config.PROXY_ID)
            .update(req.body['user'])
            .digest('hex')
            .slice(0, 16);
    }

    // Check if the client sent a streaming field, and disable it if it's not allowed
    if (req.body['stream'] && !config.ALLOW_STREAMING) {
        req.body['stream'] = false;
    }

    // Define the uploadStats function
    const uploadStats = helpers.uploadStats(method, url, usagePandaKey);

    /****************************
     Proxy Logic
    ****************************/
    // Collect stats about the request to send to Usage Panda
    const stats = {
        endpoint: req.url,
        config_cached: configLoadedFromCache,
        flags: [],
        error: false,
        autorouted: {},
        metadata: {
            proxy_id: config.PROXY_ID,
            ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            user_agent: req.headers['user-agent'],
            organization: req.headers['openai-organization'],
            trace_id: req.headers[(config.TRACE_HEADER || 'x-usagepanda-trace-id')],
        }
    };

    // Error if flags with error
    if (stats.error) {
        const rtnError = helpers.rtnError(422, 'invalid_request', `Usage Panda: ${stats.flags.map(function(f){return f.description}).join(', ')}`);
        stats.response = rtnError.body;
        await uploadStats(stats);
        return rtnError;
    }

    // Check for API conversions (e.g., OpenAI --> PaLM)
    // pc = post-conversion
    // const convertedReq = converters.request(endpoint, req.headers, req.body, config, stats);
    // const pcUrl = convertedReq.url || url;
    // const pcOptions = convertedReq.options || options;

    helpers.log.debug(`Sending ${method} request to ${pcUrl}`);
    const startTime = new Date();
    if(req.body['stream']) {
        const meta = {
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

        // Headers needed for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const readableStream = Readable.from((async function*() {
            let llmHeaders;
            let incomplete = "";
            for await (const dataStream of helpers.makeLLMStreamRequest(method, pcUrl, pcOptions)) {
                if (incomplete) {
                    helpers.log.debug(`Merging ${incomplete} with ${dataStream.body}`)
                    dataStream.body = incomplete + dataStream.body;
                    incomplete = "";
                }

                // // Include filtered headers from the LLM response
                if (!llmHeaders && !res.headersSent) {
                    llmHeaders = helpers.llmHeadersFilter(dataStream.headers);
                    res.set(llmHeaders);
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
                        yield streamedBody;
                        continue;
                    }

                    let output = JSON.parse(data)
                    let choice = output['choices'][0]

                    // Constructing an object that represents a non-streaming OpenAI response
                    meta['id'] = output['id']
                    meta['created'] = output['created']
                    meta['model'] = output['model']

                    // There are a number of "finished_reasons"
                    // stop: API returned complete message, or a message terminated by one of the stop sequences provided via the stop parameter
                    // length: Incomplete model output due to max_tokens parameter or token limit
                    // function_call: The model decided to call a function
                    // content_filter: Omitted content due to a flag from our content filters
                    // null: API response still in progress or incomplete
                    if (choice['finish_reason'] == null){
                        streamedBody +=  choice['delta']['content'] || '';
                        meta['choices'][0]['message']['content'] = streamedBody
                    }

                    meta['choices'][0]['finish_reason'] = choice['finish_reason']

                    // Since we're streaming, we will incrementally scan the response messages
                    // for (let p = 0; p < postprocessors.length; p++) {
                    //     console.log("ASDF")
                    //     const processor = postprocessors[p];
                    //     const value = helpers.extractHeaderConfig(event.headers, config, processor);
                    //     const pResponse = await processor.run(value, body, meta, config, stats);
                    //     if (pResponse) {
                    //         console.log("DETECTED")
                    //         console.log(pResponse)
                    //         // throw new Error(pResponse);
                    //         // yield pResponse;
                    //         // await uploadStats(stats);
                    //     }
                    // }

                }
                yield dataStream.body;
            }
        })());


        // Now, "readableStream" is a Readable Stream that you can pipe to other streams
        const processStream = new Promise((resolve, reject) => {
            readableStream
                .pipe(res)
                .on('error', (err) => { 
                    helpers.log.error(err)
                    reject(err)
                })
                .on('finish', (data) => {
                    res.end()
                    // Calculate the number of tokens used
                    // TODO: Not sure how heavy loading these token mappings are, we should pre-load them
                    const tokenEncoder = tiktoken.encodingForModel(meta['model'])
                    meta['usage']['prompt_tokens'] = req.body['messages'].reduce((count, message) => count + tokenEncoder.encode(message.content).length, 0);
                    meta['usage']['completion_tokens'] = tokenEncoder.encode(streamedBody).length
                    meta['usage']['total_tokens'] = meta['usage']['prompt_tokens'] + meta['usage']['completion_tokens']
                });   
        });
        
        return await processStream;
        
    } else {

        const response = await helpers.makeLLMRequest(method, pcUrl, pcOptions);
        const endTime = new Date();
        stats.metadata.latency = (endTime.getTime() - startTime.getTime());


        // Check for API conversions (e.g., PaLM --> OpenAI)
        // pc = post-conversion
        const convertedBody = converters.response(endpoint, req.headers, req.body, response.body, config, stats);
        if (convertedBody) response.body = convertedBody;

        if (response.body && response.body.error) {
            helpers.log.error(response.body.error);
            stats.error = true;
            stats.response = response.body;
            await uploadStats(stats);
            if (pResponse) {
                await uploadStats(stats);
                return res.status(response.statusCode)
                .header(response.headers)
                .send(response.body)
                .end();
            }
        }

        // Loop through the postprocessors
        for (let p = 0; p < postprocessors.length; p++) {
            const processor = postprocessors[p];
            const value = helpers.extractHeaderConfig(req.headers, config, processor);
            const pResponse = await processor.run(value, req.body, response.body, config, stats);
            if (pResponse) {
                await uploadStats(stats);
                return res.status(response.statusCode)
                .header(response.headers)
                .send(response.body)
                .end();
            }
        }

        await uploadStats(stats);

        // Error if flags with error (again, after processing response)
        if (stats.error) {
            const rtnError = helpers.rtnError(422, 'invalid_request', `Usage Panda: ${stats.flags.map(function(f){return f.description}).join(', ')}`);
            stats.response = rtnError.body;
            return res.status(response.statusCode)
            .header(response.headers)
            .send(response.body)
            .end();
        }

        helpers.log.debug(`Returning ${response.statusCode} response`);
        return res.status(response.statusCode)
            .header(response.headers)
            .send(JSON.stringify(response.body, null, 4))
            .end();
    }
})


// app.get('/v1/models', async (req, res) => {
//     const models = await helpers.getModels();
//     res.send(models).end();
// })


app.listen(port, '0.0.0.0', () => {
    console.log(`Listening on ${port}`)
  })
