export default {
    header: 'x-usagepanda-log-request',
    config: 'POLICY_LOG_REQUEST',
    run: function(value, request, config, stats) {
        stats.request = JSON.parse(JSON.stringify(request)); // Quick-copy the object so we can delete properties

        if (value && value == 'true') return;
        
        // By default, we do not want to log the request payload
        if (stats.request.prompt) delete stats.request.prompt;           // completions
        if (stats.request.input) delete stats.request.input;             // moderations, edits
        if (stats.request.messages) delete stats.request.messages;       // chat completions
        if (stats.request.instruction) delete stats.request.instruction; // edits
    }
};