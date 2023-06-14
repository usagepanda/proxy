// import {jest} from '@jest/globals';
// import {handler} from '../index.js';
import config from '../config.js';

test('Ensure critical expected config defaults have not been modified', async () => {
    expect(config.LOCAL_MODE).toBe(false);
    expect(config.USAGE_PANDA_API).toBe('https://api.usagepanda.com/v1');
    expect(config.LLM_API_BASE_PATH).toBe('https://api.openai.com');
});

test('Ensure config file format', async () => {
    // Ensure format of config params
    Object.keys(config).forEach(function(k){
        expect(k).toMatch(/^[A-Z_]{1,}$/);
    });
});
