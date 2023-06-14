export default {
    header: 'x-usagepanda-log-response',
    config: 'POLICY_LOG_RESPONSE',
    run: function(value, request, response, config, stats) {
        stats.response = JSON.parse(JSON.stringify(response)); // Quick-copy the object so we can delete properties
    
        // Remove embeddings from the stats upload (we never want to log these)
        if (stats.response.data &&
            stats.response.data[0] &&
            stats.response.data[0].object &&
            stats.response.data[0].object === 'embedding') {
            delete stats.response.data;
        }

        if (value && value == 'true') return;
        
        // By default, we do not want to log the request payload
        if (stats.response.choices) delete stats.response.choices; // completions, chat completions, edits
        if (stats.response.data) delete stats.response.data;       // images
    }
};