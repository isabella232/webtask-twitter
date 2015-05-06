require('dotenv').load();
var assert = require('assert')
    , request = require('request')
    , Entities = require('html-entities').AllHtmlEntities
    , entities = new Entities()
    , Twitter = require('twitter');

[
'CONSUMER_KEY',
'CONSUMER_SECRET',
'ACCESS_TOKEN',
'ACCESS_TOKEN_SECRET',
'WEBTASK_URL',
'WEBTASK_TOKEN'
].forEach(function (v) { 
    assert.ok(process.env[v] !== undefined, v + ' environment variable not set.'); 
});

var logger = require('bunyan').createLogger({ name: 'webtask-twitter' });
var twitter = new Twitter({
    "consumer_key": process.env.CONSUMER_KEY,
    "consumer_secret": process.env.CONSUMER_SECRET,
    "access_token_key": process.env.ACCESS_TOKEN,
    "access_token_secret": process.env.ACCESS_TOKEN_SECRET
});

twitter.stream('user', {}, function (stream) {
    logger.info('attached to twitter stream');
    stream.on('data', process_tweet);
    stream.on('error', function(error) {
        logger.error(error, 'error, exiting process in 500ms');
        setTimeout(function () {
            process.exit(1);
        }, 500);
    });
});

var run_code = /^\s*run\s+\@webtaskio(?:\:|\s+)\s*(.*)$/i;
var suffix = ' /via https://webtask.io';
function process_tweet(tweet) {
    if (typeof tweet !== 'object')
        return;
    if (!tweet.text || !tweet.user.screen_name || !tweet.id)
        return;
    tweet.text = entities.decode(tweet.text);
    logger.info({ 
        id: tweet.id, 
        user: tweet.user.screen_name, 
        text: tweet.text 
    }, 'incoming');
    if (tweet.retweeted_status) {
        logger.info({ id: tweet.id }, 'ignore: retweet');
        return;
    }
    var match = tweet.text.match(run_code);
    if (!match) {
        logger.info({ id: tweet.id }, 'ignore: no match');
        return;
    }
    var code = match[1].trim();
    logger.warn({ 
        id: tweet.id, 
        user: tweet.user.screen_name, 
        code: code 
    }, 'match');
    if (code.indexOf('return') !== 0)
        code = '"use latest";\nreturn ' + code;
    else
        code = '"use latest";\n' + code;
    var container = 'wt-tweet-' + Math.floor(10 * Math.random());
    var url = process.env.WEBTASK_URL + '/api/run/' + container;

    request({
        method: 'POST',
        url: url,
        headers: {
            'Authorization': 'Bearer ' + process.env.WEBTASK_TOKEN
        },
        body: code,
        timeout: 10000
    }, function (error, res, body) {
        var msg;
        if (error) {
            logger.error(error, 'webtask execution error');
            msg = 'Oops... @webtaskio is unable to execute your code at the moment';
        }
        else if (res.statusCode == 200) {
            logger.info({ 
                status: 200, 
                container: container, 
                body: body 
            }, 'webtask response');
            msg = 'result from @webtaskio: ' + body;
        }
        else {
            logger.warn({ 
                status: res.statusCode, 
                container: container, 
                code: code, 
                body: body 
            }, 'webtask error response');
            msg = 'Oops... @webtaskio responded HTTP ' + res.statusCode + ': ' + body;            
        }

        msg = '@' + tweet.user.screen_name + ' ' + msg;
        if ((msg.length + 1 + suffix.length) > 135)
            msg = msg.substring(0, 132 - suffix.length) + '...';
        msg += suffix;

        twitter.post('statuses/update', {
            status: msg,
            in_reply_to_status_id: tweet.id.toString()
        }, function (error) {
            if (error)
                return logger.error({ 
                    msg: msg, 
                    error: error.message || error.toString() 
                }, 'error sending response');
            logger.warn({ result: msg }, 'sent response');
        });
    });
}
