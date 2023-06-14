[<img src="https://usagepanda.com/assets/images/logo/full-logo.png"  width="60%">](https://usagepanda.com?ref=github)

# Usage Panda LLM Proxy

The Usage Panda proxy is a lightweight proxy that sits between your application and LLM APIs, such as OpenAI, in order to enforce security, cost, rate limiting, and other policy controls on requests and responses. It can optionally retrieve a dynamic configuration from, and log analytics to, [Usage Panda's SaaS](https://app.usagepanda.com) API. The Usage Panda proxy can be deployed locally, along side your application, as a container in a Kubernetes environment, or in your cloud environment as a containerized or serverless application (e.g., AWS Lambda).

# Background
While it's easy to experiment with LLM APIs, operationalizing them for production applications can be much more challenging. Many developers and organizations are struggling to safely deploy applications that rely on these APIs while being cognizant of costs, security, compliance, data protection, logging, auditing, error handling, failover, and other requirements. Usage Panda aims to address these concerns by intercepting, inspecting, and optionally modifying or blocking, requests and responses to and from popular LLM APIs (OpenAI, PaLM, Azure, etc.).

In its simplest deployment mode, Usage Panda functions as a pass-through proxy to upstream APIs, such as OpenAI, logging requests and responses (along with metadata such as API latency). However, the proxy can be configured with many additional options, allowing you to inspect requests for possible prompt tampering attacks, block responses that contain certain keywords, automatically retry failed requests or moderate request content, and more, functioning as a "firewall" between your application (and its user-generated content) and upstream LLMs.

# Getting Started
To run the proxy locally using Docker:

```bash
$ git clone git@github.com:usagepanda/usage-panda-proxy.git
$ cd usage-panda-proxy
```

Next, edit the `config.js` file and change `LOCAL_MODE` to `true`. Then build/run the container:

```bash
$ docker build . -t usage-panda/proxy:latest
$ docker run --restart=always -p 9000:9000 -d -v $(pwd)/config.js:/config.js:ro usage-panda/proxy:latest
```

You can test your deployment (you will need an OpenAI API key set as `OPENAI_API_KEY`) by running:

```bash
curl http://localhost:9000/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer $OPENAI_API_KEY" -d '{"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "Say this is a test!"}], "temperature": 0.7}'
```

You should see the response:
```json
{"id":"chatcmpl-7R89ybLuVr6d8eJ5ADg6lW8gH4FC5","object":"chat.completion","created":1686700578,"model":"gpt-3.5-turbo-0301","usage":{"prompt_tokens":14,"completion_tokens":5,"total_tokens":19},"choices":[{"message":{"role":"assistant","content":"This is a test!"},"finish_reason":"stop","index":0}]}
```

And if you check the proxy logs, you should see debug statements about the request logged to stdout.

## OpenAI SDK Updates
With your proxy running locally, if you are using the OpenAI SDK, you can set the OpenAI API endpoint:

```python
import openai
openai.api_base = "http://localhost:9000/v1"
```

# Proxy Features
The Usage Panda proxy ships with a number of helpful features, including:

* Lightweight - the proxy has only 1 direct dependency (`got`) and weighs less than 500kb
* Audit Logging - log the full request and response details of each API key, along with additional metadata about the request (latency, end user information, security/compliance flags, etc.)
* Cost Protections - limit request sizes, enforce `max_token` usage, and limit the LLM models that are available via the proxy
* Content Moderation - audit, redact, or block profanity, adult content, and possible prompt tampering prompts (e.g., "Do Anything Now")
* Auth Management - set your OpenAI API key at the proxy level so that downstream applications do not need to set their own keys. You can then layer alternative authorization controls in front of the proxy.
* Auto-Retry - automatically retry requests to upstream LLM APIs
* Prompt Reflection Detection - use delimeters to mark portions of the prompt that should not be revealed to end-users and audit, redact, or block responses that contain them

## Config File
The `config.js` file contains the settings for activating all of the above controls. Some settings can be configured via environment variables.

# Plugin Model
The Usage Panda proxy works by inspecting requests and responses to and from LLM APIs. For each request, a series of `preprocessors` are run, and for each response, a series of `postprocessors`. Each pre and post processor provides a different piece of functionality. For example, the `auto-moderate` preprocessor extracts the user-generated content from the prompt, makes a request to OpenAI's "moderation" API, and then evaluates the response for the presence of potentially-sensitive content.

Both pre and post processors can define an optional `header` and `config` property that specify where the Usage Panda proxy should obtain its configuration data. For example, the `auto-moderate` preprocessor defines:

```javascript
export default {
    header: 'x-usagepanda-auto-moderate',
    config: 'POLICY_AUTO_MODERATE',
    ...
}
```

Which tells the rules engine to extract the possible config values from the header (primarily) or the config file (as a fallback). Headers always take precedence over the locally-defined config values.

# API Converters
An experimental feature of Usage Panda is to support the dynamic conversion of OpenAI-formatted API requests to other API providers, such as Azure's OpenAI or Google's PaLM. This feature means your application can "hot swap" LLM APIs without any functional code changes, and even allows you to continue using the OpenAI SDKs when the requests are actually being routed to an entirely different service via the proxy.

To support this conversion, Usage Panda passes the request through a converter utility depending on its destination. For example, if the `x-usagepanda-azure-resource` header is sent, Usage Panda will dynamically convert the request from OpenAI's API format into Azure's, including changing the URL, API key format, etc.

Currently, Usage Panda supports converters for OpenAI to Azure or PaLM for the completions and chat completions endpoints.

# Word Lists
The `profanity` and `adult` word lists were taken from zcanger's [profane-words](https://github.com/zacanger/profane-words/blob/master/words.json) repository with some modifications. These lists are designed to restrict the content that can be sent to your users from LLM APIs. Usage Panda does not condone the use of these words outside of this limited context. You may wish to modify or remove these lists, based on your application's requirements. We strongly recommend leveraging "audit" mode prior to implementing these content controls to determine how your application and users will be impacted.

## "Do Anything Now" List
The DAN (do anything now) list contains a series of phrases that represent attempts to maliciously modify the prompt or cause unintended LLM behavior ("prompt injection"). This is an experimental feature, and is currently quite limited (and easily defeated by encoding or chaining responses). However, this is one tool in your LLM defense toolbox, and we recommend combining signals from this word list with user rate limiting or blocking.

# Logging
The proxy logs to stderr/stdout. Each request has debug and info logs, and processed requests end with a final log line containing a full set of stats, metadata, and request/response details.

The stats are contained in the final log line:

```json
{
    "level":"debug",
    "proxy_id":"usage_panda_cloud",
    "message":{
        "endpoint":"/v1/chat/completions",
        "config_cached":true,
        "flags":[],
        "error":false,
        "autorouted":{},
        "metadata":{
            "proxy_id":"usage_panda_cloud",
            "latency":1126
        },
        "request":{
            "model":"gpt-3.5-turbo",
            "temperature":0.7
        },
        "response":{
            "id":"chatcmpl-7R89ybLuVr6d8eJ5ADg6lW8gH4FC5",
            "object":"chat.completion",
            "created":1686700578,
            "model":"gpt-3.5-turbo-0301",
            "usage":{
                "prompt_tokens":14,
                "completion_tokens":5,
                "total_tokens":19
            }
        }
    }
}
```

If the `POLICY_LOG_REQUEST` and `POLICY_LOG_RESPONSE` config values are set to `true`, then the above logs will also contain the full request prompt payload and the response from the LLM API.

# Deploying via AWS Lambda
To deploy the Usage Panda proxy in Lambda:
1. ZIP up the contents of the directory
2. Upload the ZIP to S3
3. Create a new Lambda function and pass in the ZIP source
4. Set the `handler` to `index.handler`
5. Set the memory to at least 1024 GB
6. Set the environment variables as necessary (see `config.js`)
7. Expose the Lambda function via a function URL or API Gateway endpoint.

WARNING: Usage Panda's proxy does not ship with built in authentication. Do not expose the proxy publicly without deploying authentication in front of it (e.g., using API Gateway's API keys).

# Known Limitations
* Usage Panda does not yet support streaming.
* File uploads, such as uploading an audio file to OpenAI's transcription service, are not yet supported

# Roadmap
Usage Panda's modular plugin model means that additional checks and controls can be added easily. The LLM security and compliance space is evolving rapidly, so there are many additional controls that can be developed, including:

* Expanding prompt injection capabilities: more robust word lists, intent recognition (possibly via a [dual-LLM system](https://simonwillison.net/2023/Apr/25/dual-llm-pattern/))
* PII detection (possibly via a managed service such as [AWS Comprehend](https://docs.aws.amazon.com/comprehend/latest/dg/how-pii.html))
* Rate limiting - by request type, model, user, IP address, etc.
* Caching - this can be challenging for LLM-based systems, but we could cache responses for identical prompts
* Defenses against [garak](https://github.com/leondz/garak/tree/main), an LLM security probing utility
* Additional LLM API support - Claude, Anthropic, etc.
* Expanding the automated test suite coverage
* Adding a CloudFormation template for easy deployment to AWS Lambda

# Contributing
Usage Panda welcomes community contributions, but please keep the following considerations in mind:
* Usage Panda is designed to be lightweight; we do not want to add any additional third-party libraries unless absolutely necessary
* Pre and post processor plugins should be opt-in via a configuration or header setting (by default, the Usage Panda proxy should be pass-through with no request or response modifications)
* The Usage Panda proxy should be able to run entirely in isolation without connectivity to third-party APIs/services (aside from the LLM APIs it is proxying)

# Usage Panda Hosted Service
While the proxy can run entirely on its own, with no connectivity to Usage Panda's API, you can optionally create a Usage Panda API key to record stats and metrics about your requests, visualize cost and usage data in the Usage Panda dashboard, and define the configuration behavior of the proxy based on the key passed in the request. You can read more about these features in Usage Panda's [SaaS documentation](https://docs.usagepanda.com).

[<img src="https://usagepanda.com/assets/images/dash-1.png"  width="49%">](https://app.usagepanda.com) [<img src="https://usagepanda.com/assets/images/dash-2.png"  width="49%">](https://app.usagepanda.com)

[<img src="https://usagepanda.com/assets/images/dash-3.png"  width="49%">](https://app.usagepanda.com) [<img src="https://usagepanda.com/assets/images/dash-4.png"  width="49%">](https://app.usagepanda.com)
