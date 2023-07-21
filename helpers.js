import got from 'got';
import proxyConfig from './config.js';
import * as AWS from "@aws-sdk/client-ssm";
import fs from 'fs';

let cache = {};

// Reset cache every N minutes
setInterval(function(){
    log.debug('Resetting cache')
    cache = {};
}, 1000 * 60 * proxyConfig.CONFIG_CACHE_MINUTES);

const helpers = {
    // Basic logging and redaction utilities
    log: {
        debug: function(msg) {
            if (proxyConfig.DEBUG_MODE == false) return;
            let stack = new Error().stack;
            let callerName = stack.split('\n')[2].trim().trim();
            console.debug(JSON.stringify({
                level: 'debug',
                proxy_id: proxyConfig.PROXY_ID,
                message: msg,
                caller: callerName
            }));
        },
        info: function(msg) {
            console.info(JSON.stringify({
                level: 'info',
                proxy_id: proxyConfig.PROXY_ID,
                message: msg
            }));
        },
        warn: function(msg) {
            console.warn(JSON.stringify({
                level: 'warn',
                proxy_id: proxyConfig.PROXY_ID,
                message: msg
            }));
        },
        error: function(msg) {
            let stack = new Error().stack;
            let callerName = stack.split('\n')[2].trim().split(' ')[1];
            console.error(JSON.stringify({
                level: 'error',
                proxy_id: proxyConfig.PROXY_ID,
                message: msg,
                caller: callerName
            }));
        }
    },

    // Handle CORS responses
    processOptions: function(event) {
        if (event.requestContext.http.method == 'OPTIONS') {
            this.log.debug('CORS response');
            return {
                statusCode: 200,
                headers: proxyConfig.CORS_HEADERS,
                body: {}
            };
        } else {
            return false;
        }
    },

    // Returns an OpenAI-formatted error message (JSON)
    rtnError: function(code, type, msg) {
        return {
            statusCode: code,
            headers: proxyConfig.CORS_HEADERS,
            body: {
                error: {
                    message: msg,
                    type: type,
                    param: null,
                    code: null
                }
            }
        };
    },

    // Returns an OpenAI-formatted completion request
    rtnCompletion: function(model, response) {
        return {
            statusCode: 200,
            headers: proxyConfig.CORS_HEADERS,
            body: {
                id: 'cmpl-usagepanda',
                object: 'text_completion',
                created: Math.floor(Date.now()/1000),
                model: model || 'text-davinci-003',
                choices: [
                    {
                        text: response,
                        index: 0,
                        logprobs: null,
                        finish_reason: 'stop'
                    }
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            }
        };
    },

    // Returns an OpenAI-formatted chat completion request
    rtnChatCompletion: function(model, response) {
        return {
            statusCode: 200,
            headers: proxyConfig.CORS_HEADERS,
            body: {
                id: 'chatcmpl-usagepanda',
                object: 'chat.completion',
                created: Math.floor(Date.now()/1000),
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: response,
                        },
                        finish_reason: 'stop'
                    }
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            }
        };
    },

    // Extracts the Usage Panda and OpenAI auth headers
    extractHeaders: function(event) {
        if (!event.headers) {
            this.log.warn('No headers in request');
            return {headerError: this.rtnError(403, 'access_denied', 'No API keys found in headers')};
        }


        const customAuth = proxyConfig.CUSTOM_AUTH_HANDLER(event.headers['authorization'])
        if (customAuth){
            // We're authenticating the request with our custom function
            // We are assuming the openAIKey and usagePandaKey are provided or default
            return {
                openAIKey: `Bearer ${customAuth.openAIKey || proxyConfig.OPENAI_API_KEY}`,
                usagePandaKey: (customAuth.usagePandaKey || proxyConfig.USAGE_PANDA_API_KEY),
                customAuth
            };
        }
        

        // Extract the Usage Panda key from the auth header or config
        const usagePandaKey = event.headers['x-usagepanda-api-key'] || proxyConfig.USAGE_PANDA_API_KEY;
        if (!proxyConfig.LOCAL_MODE &&
            (!usagePandaKey ||
            !usagePandaKey.length ||
            !/^up-[0-9a-zA-Z]{48}$/.test(usagePandaKey))) {
            this.log.warn('Invalid Usage Panda API key. Either pass the x-usagepanda-api-key header or set the USAGE_PANDA_API_KEY environment variable.');
            return {headerError: this.rtnError(403, 'access_denied', 'Invalid Usage Panda API')};
        }

        // Extract the OpenAI API key from the auth header or config
        // Azure OpenAI keys are 16 byte hex strings
        const openAIKey = event.headers['authorization'] || `Bearer ${proxyConfig.OPENAI_API_KEY}`;
        if (!openAIKey ||
            !openAIKey.length ||
            !/^Bearer (sk-[0-9a-zA-Z]{48}|[a-z0-9]{32})$/.test(openAIKey)) {
            this.log.warn('Invalid OpenAI API key. Either pass the authorization header or set the OPENAI_API_KEY environment variable.');
            return {headerError: this.rtnError(403, 'access_denied', 'Invalid OpenAI API key')};
        }

        // Chat keys can only use the chat endpoint
        if (usagePandaKey && usagePandaKey.indexOf('up-chat') === 0 && event.requestContext.http.path !== '/v1/chat/completions') {
            this.log.warn('Usage Panda chat API key used for non-chat endpoint');
            return {headerError: this.rtnError(403, 'access_denied', 'Chat API keys can only be used for the /v1/chat/completions endpoint')};
        }

        return {openAIKey, usagePandaKey};
    },

    // Load the config from cache or the Usage Panda API
    loadConfig: async function(usagePandaKey) {
        this.log.debug("Loading config")
        // If local mode, return an empty config (do not load from Usage Panda)
        if (proxyConfig.LOCAL_MODE) {
            this.log.debug('Local mode enabled; returning default local config');
            return { config: proxyConfig, configLoadedFromCache: true };
        }
        return { config: proxyConfig, configLoadedFromCache: true };

        function mergeAndReturn(config) {
            // Take the cached or queried config, merge it with the local config and return
            // If the loaded config contains the same property as the local proxy config
            // then the loaded config overwrites the local proxy version.
            return {
                ...proxyConfig,
                ...config
            };
        }

        if (cache[usagePandaKey] && cache[usagePandaKey].CACHE_ENABLED) {
            // Config found in memory cache
            const config = cache[usagePandaKey];
            this.log.debug('Found config in memory');
            this.log.debug(config);
            return { config: mergeAndReturn(config), configLoadedFromCache: true };
        } else if (proxyConfig.CONFIG_CACHE_TYPE){
            this.log.debug("trying to load from cache")
            let cachedConfig = await getConfigCache(usagePandaKey);
            
            if(cachedConfig) {
                log.debug(JSON.stringify(cachedConfig))
                log.debug(`Loaded configuration from ${proxyConfig.CONFIG_CACHE_TYPE}`)
                return { config: mergeAndReturn(cachedConfig), configLoadedFromCache: true };
            }
        }
        // No cached config found, let's grab it
        this.log.debug('No cache found, or cache disabled. Retrieving config.');
        let retrievedConfig = await this.retrieveConfig(usagePandaKey);
        if (retrievedConfig.configError) return { configError: retrievedConfig.configError, config: mergeAndReturn(retrievedConfig), configLoadedFromCache: false };
        return  { config: mergeAndReturn(retrievedConfig), configLoadedFromCache: false }
    },

    retrieveConfig: async function(usagePandaKey) {
        try {
            const response = await got.get(`${proxyConfig.USAGE_PANDA_API}/proxy`, {
                headers: {
                    'x-usagepanda-key': usagePandaKey
                }
            }).json();
            
            // Ensure config is valid
            if (!response || !response.LLM_API_BASE_PATH) return {
                configError: this.rtnError(500, 'server_error', 'Error loading Usage Panda config'),
                config: proxyConfig,
                configLoadedFromCache: true
            };
            
            if (response.CACHE_ENABLED){
                cache[usagePandaKey] = response;
                this.log.debug(proxyConfig.CONFIG_CACHE_TYPE)
                this.log.debug('Loaded config from Usage Panda API');
                this.log.debug(response);
                
                // Also store in a persistent cache if specified
                if (proxyConfig.CONFIG_CACHE_TYPE){
                    this.log.debug(`Storing loadded config in ${proxyConfig.CONFIG_CACHE_TYPE}`);
                    await storeConfigCache(response, usagePandaKey)
                }
            }
            return { config: mergeAndReturn(response), configLoadedFromCache: false };
        } catch (error) {
            this.log.error(error);
            return {
                configError: this.rtnError(500, 'server_error', 'Server error loading Usage Panda config'),
                config: proxyConfig,
                configLoadedFromCache: true
            };
        }
    },

    // Send stats to Usage Panda
    uploadStats: function(method, url, usagePandaKey) {
        const localLog = this.log;
        
        return async function(stats) {
            if (method !== 'post') {
                localLog.debug(`Skipping stats upload for ${method} method endpoint ${url}`);
                localLog.debug(stats);
                return;
            }

            // If local mode, do not upload any stats
            if (proxyConfig.LOCAL_MODE) {
                localLog.debug('Local mode enabled; skipping stats upload');
                localLog.debug(stats);
                return;
            }

            localLog.debug('Sending stats to Usage Panda');
            localLog.debug(stats);

            const uploadOptions = {
                headers: {
                    'x-usagepanda-key': usagePandaKey
                },
                timeout: {
                    send: 3500
                },
                json: stats
            };
            
            try {
                if (proxyConfig.ASYNC_STATS_UPLOAD) {
                    localLog.debug('Async stats upload mode enabled. Returning response.');
                    got.post(`${proxyConfig.USAGE_PANDA_API}/proxy`, uploadOptions);
                } else {
                    localLog.debug('Async stats upload mode disabled. Waiting on stats upload.');
                    await got.post(`${proxyConfig.USAGE_PANDA_API}/proxy`, uploadOptions);
                }
            } catch (error) {
                localLog.error(`Error uploading stats to Usage Panda. Failing open. ${error}`);
            }
        }
    },

    // Make request to upstream LLM
    makeLLMRequest: async function(method, url, options) {
        try {
            const response = await got[method](url, options);
            return {
                statusCode: response.statusCode,
                headers: {
                    ...this.llmHeadersFilter(response.headers),
                    ...proxyConfig.CORS_HEADERS
                },
                body: JSON.parse(response.body)
            };
        } catch (error) {    
            this.log.error(`Received error while making LLM API request`);
            this.log.error(error);
            return {
                statusCode: error.response.statusCode,
                headers: {
                    ...this.llmHeadersFilter(error.response.headers),
                    ...proxyConfig.CORS_HEADERS
                },
                body: (error.response && error.response.body) ? JSON.parse(error.response.body) : {}
            };
        }
    },

    // Make request to upstream LLM with streaming enabled
    makeLLMStreamRequest: async function*(method, url, options) {
        let statusCode;
        let headers;
        try {
            const stream = got.stream[method](url, options); // use got.stream for server-sent events

            // Grab response headers from the LLM. These can contain useful details like rate limit headers.
            stream.on('response', (response) => {
                statusCode = response.statusCode; // save status code when response is received
                headers = response.headers; // save headers when response is received
            });

            for await (const chunk of stream) { // Iterate over chunks of data from stream
                yield {
                    statusCode: statusCode,
                    headers: {
                        ...this.llmHeadersFilter(headers),
                        ...proxyConfig.CORS_HEADERS
                    },
                    body: chunk.toString() // parse each chunk of data 
                };
            }
        } catch (error) {
            this.log.error(`Received error while making LLM API Streaming request`);
            yield { // yield error response
                statusCode: error.response ? error.response.statusCode : 500,
                headers: headers || {},
                body: (error.response && error.response.body) ? JSON.parse(error.response.body) : {}
            };
        }
    },

    // Given a wordlist name, load the list, split into an array by lines
    // and then check the input for the presence of any words.
    // If mode is "redact", return a new string with *** replacements
    // return: {matched, finalString}
    matchesWordlist: function(wordlist, input, customList) {
        const wordFile = customList ? '' : fs.readFileSync(`./wordlists/${wordlist}.txt`, { encoding: 'utf8', flag: 'r' });
        const lines = customList || wordFile.split('\n');

        let matches = [];
        let newInput = input;

        lines.forEach(function(line){
            const reg = new RegExp(line, 'ig');
            if (input.match(reg)) {
                matches.push(line);
                newInput = newInput.replace(reg, proxyConfig.REDACTION_STRING);
            }
        });

        return {
            matched: matches.length ? true : false,
            newString: newInput
        };
    },

    // The function below extracts a defined config value from the headers (if set) and then falls back
    // to the config object (either loaded locally or obtained via API)
    extractHeaderConfig: function(headers, config, processor) {
        if (processor.header && typeof headers[processor.header] !== 'undefined' && headers[processor.header] !== null) {
            return headers[processor.header].toString().toLowerCase();
        }

        if (processor.config && typeof config[processor.config] !== 'undefined' && config[processor.config] !== null) {
            if (typeof config[processor.config] == 'object') return config[processor.config];
            return config[processor.config].toString().toLowerCase();
        }

        return null;
    },

    // We can include headers from the LLM response, which can contain useful information about the request
    llmHeadersFilter: function(headers){
        let acceptedFilters = [
            /^x-ratelimit/,
            /^openai/,
            /^azureml/
        ]

        // Filter out headers that do not match the accepted filters
        return Object.fromEntries(
            Object.entries(headers).filter(([key]) =>
                acceptedFilters.some((regex) => regex.test(key))
            )
        );
    }
};


// Config cache management
// This is used to store the config in a central location, mostly useful for the lambda instance.
const storeConfigCache = async function(cachedConfig, usagePandaKey){
    const cacheStorage = {
        ssm: async function(cachedConfig, usagePandaKey) {
            let ssm = new AWS.SSM();
            log.debug(`Writing config to ${proxyConfig.CONFIG_CACHE_PATH}/${usagePandaKey}`)
            const input = { 
                Name: `${proxyConfig.CONFIG_CACHE_PATH}/${usagePandaKey}`,
                Description: "Cached usage panda proxy config",
                Value: JSON.stringify(cachedConfig),
                Type: "SecureString",
                Overwrite: true,
                WithDecryption: true
            };

            return ssm.putParameter(input, function(err, data){
                if(err){
                    log.error('Error storing parameter.');
                    log.error(err);
                    return err
                } else {
                    log.debug('Parameter stored');
                    return true
                }
            })
        },
        file: async function(cachedConfig, usagePandaKey) {
            // fs.mkdir create directory if it doesn't exist
            fs.mkdir(proxyConfig.CONFIG_CACHE_PATH, { recursive: true }, (err) => {
                if (err && err.code == 'EEXIST') {
                    // ignore the error if the folder already exists
                    log.debug(`Error creating config cache directory. ${err}`);
                } else if (err) {
                    log.error(`Error creating config cache directory. ${err}`);
                }
                log.debug(`Created config directory ${proxyConfig.CONFIG_CACHE_PATH}`);
            });
            fs.writeFile(`${proxyConfig.CONFIG_CACHE_PATH}/${usagePandaKey}.json`, JSON.stringify(cachedConfig, null, 4), function(err){
                if(err){
                    log.error(`Error storing config cache to file. ${err}`);
                    return err
                }
                log.info(`Config written to ${proxyConfig.CONFIG_CACHE_PATH}/${usagePandaKey}.json`);
                return true
            });
        }
    }
    return await cacheStorage[proxyConfig.CONFIG_CACHE_TYPE](cachedConfig, usagePandaKey);
}

const getConfigCache = function(usagePandaKey){
    const cacheStorage = {
        ssm: async function(usagePandaKey) {
            log.debug(`Trying to read cached config from ${proxyConfig.CONFIG_CACHE_TYPE} path: ${proxyConfig.CONFIG_CACHE_PATH}/${usagePandaKey}`);
            let ssm = new AWS.SSM();
            let params = {
                    Name: `${proxyConfig.CONFIG_CACHE_PATH}/${usagePandaKey}`,
                    WithDecryption: true
                }
            let retrieveCache = await ssm.getParameter(params)
            try {
                let data = await ssm.getParameter(params);
                log.debug(`Found config in ${proxyConfig.CONFIG_CACHE_TYPE}`);
                log.debug(data);
            } catch (err) {
                log.error('Error getting parameter: ' + err, err.stack);
                return false;

            }
            if(Date.parse(await retrieveCache.Parameter.LastModifiedDate) < (Date.now() - (1000 * 60 * proxyConfig.CONFIG_CACHE_MINUTES))){
                log.debug(`Config cache is older than ${proxyConfig.CONFIG_CACHE_MINUTES} minutes. Returning false`);
                return false
            }
            return JSON.parse(await retrieveCache.Parameter.Value)
        },
        file: async function(usagePandaKey) {
            this.log.debug(`Trying to read cached config from ${proxyConfig.CONFIG_CACHE_TYPE} path: ${proxyConfig.CONFIG_CACHE_PATH}/${usagePandaKey}.json`);
            let retrieveCache = fs.readFile(`${proxyConfig.CONFIG_CACHE_PATH}/${usagePandaKey}.json`, 'utf8', function(err, data){
                if (err && err.code == 'ENOENT') {
                    return false
                } else if (err) {
                    log.error(`Error retrieving config cache from file. ${err}`);
                    return false
                } else {
                    log.debug(`Found config in ${proxyConfig.CONFIG_CACHE_TYPE}`);
                    return JSON.parse(data)
                }
            });
            return retrieveCache
        }
    }
    return cacheStorage[proxyConfig.CONFIG_CACHE_TYPE](usagePandaKey)
}

const log = helpers.log

export default helpers;