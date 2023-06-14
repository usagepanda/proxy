'use strict';

import * as http from 'http'
import * as url from 'url'
import * as lambda from './index.js'

const requestListener = function(req, res) {
    let body = [];
    req.on('data', (chunk) => {
        body.push(chunk);
    }).on('end', () => {
        body = Buffer.concat(body).toString();

        lambda.handler({
            version: 1,
            resource: req.url,
            path: req.url,
            httpMethod: req.method,
            rawHeaders: req.headers,
            headers: req.headers,
            multiValueHeaders: null,
            queryStringParameters: url.parse(req.url,true).query,
            multiValueQueryStringParameters: null,
            requestContext: {
                http: {
                    method: req.method,
                    path: req.url
                }
            },
            pathParameters: null,
            stageVariables: null,
            body: (body || null)
        }, {}).then(function(data){
            res.writeHead(data.statusCode, data.headers);
            if (typeof data.body == 'string') {
                res.write(data.body);
            } else {
                res.write(JSON.stringify(data.body));
            }
            res.end();
        });
    });
};

const server = http.createServer(requestListener);
server.listen(9000);