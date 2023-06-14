import logrequest from './log-request.js';
import maxtokens from './max-tokens.js';
import maxpromptchars from './max-prompt-chars.js';
import enforceuserids from './enforce-user-ids.js';
import disabledmodels from './disabled-models.js';
import automoderate from './auto-moderate.js';
import autoreply from './auto-reply.js';
import requestwordlists from './request-wordlists.js';
import retrycount from './retry-count.js';

export default [
    logrequest,
    autoreply,
    maxtokens,
    maxpromptchars,
    enforceuserids,
    disabledmodels,
    retrycount,
    automoderate,
    requestwordlists
];