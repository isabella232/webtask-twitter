require('dotenv').load();
var async = require('async')
    , fs = require('fs')
    , path = require('path')
    , assert = require('assert')
    , request = require('request')
    , Entities = require('html-entities').AllHtmlEntities
    , entities = new Entities();

[
'CONSUMER_KEY',
'CONSUMER_SECRET',
'ACCESS_TOKEN',
'ACCESS_TOKEN_SECRET',
'DELAY',
'WEBTASK_URL',
'WEBTASK_TOKEN'
].forEach(function (v) { 
    assert.ok(process.env[v] !== undefined, v + ' environment variable not set.'); 
});

var logger = require('bunyan').createLogger({ name: 'webtask-twitter' });
var Twitter = require('twitter-node-client').Twitter;

var config = {
    "consumerKey": process.env.CONSUMER_KEY,
    "consumerSecret": process.env.CONSUMER_SECRET,
    "accessToken": process.env.ACCESS_TOKEN,
    "accessTokenSecret": process.env.ACCESS_TOKEN_SECRET
};

var twitter = new Twitter(config);
var max_id, since_id, new_since_id;
var state_file = path.join(__dirname, 'state.json');

try {
    since_id = require(state_file).since_id;
    logger.warn({ since_id: since_id }, 'restored bookmark');
}
catch (e) {
    logger.warn('no bookmark restored');
}

async.forever(
    function (next) {
        async.doWhilst(
            function (callback) {

                twitter.getSearch({
                    q: '@webtaskio',
                    count: 5,
                    since_id: since_id,
                    max_id: max_id || since_id
                }, on_error, on_data);

                function on_data(data) {
                    data = JSON.parse(data);
                    logger.info({ 
                        count: data.statuses.length, 
                        max_id: max_id, 
                        since_id: since_id, 
                        new_since_id: new_since_id 
                    }, 'result');
                    if (data.statuses.length > 0) {
                        max_id = data.statuses[data.statuses.length - 1].id - 1;
                        if (!new_since_id)
                            new_since_id = data.statuses[0].id;
                        async.eachLimit(data.statuses, 5, process_tweet, callback);
                    }
                    else {
                        if (new_since_id) {
                            since_id = new_since_id;
                            logger.warn({ since_id: since_id }, 'storing bookmark');
                            fs.writeFileSync(state_file, JSON.stringify({ since_id: since_id }), 'utf8');
                        }
                        max_id = new_since_id = undefined;
                        callback();
                    }
                }

                function on_error(error, res, body) {
                    logger.error(error, 'error');
                    callback();
                }
            },
            function () { 
                logger.info({ 
                    continue_paging: max_id !== undefined && since_id !== undefined, 
                    max_id: max_id, 
                    since_id: since_id, 
                    new_since_id: new_since_id 
                }, 'paging test');
                return max_id !== undefined && since_id !== undefined; 
            },
            function (error) {
                error ? next(error) : setTimeout(next, +process.env.DELAY);
            }
        )
    },
    function (error) {
        logger.error(error, 'error');
    }
);

var run_code = /^\s*run\s+\@webtaskio\:(.*)/i;
var suffix = ' /via https://webtask.io';
function process_tweet(tweet, callback) {
    logger.info({ 
        id: tweet.id, 
        user: tweet.user.screen_name, 
        text: tweet.text 
    }, 'considering tweet');
    if (tweet.retweeted_status) {
        logger.info({ id: tweet.id }, 'ignoring retweet');
        return callback(); // ignore retweets
    }
    var match = entities.decode(tweet.text).match(run_code);
    if (!match) {
        logger.info({ id: tweet.id }, 'ignoring tweet that does not match pattern');
        return callback(); // ignore tweets that are not request to run code
    }
    var i = match[1].lastIndexOf('}');
    if (i < 0) 
        i = match[1].lastIndexOf(';');
    if (i < 0) {
        logger.info({ id: tweet.id }, 'ignoring tweet that does not have ; or }');
        return callback(); // does not contain a function
    }
    var code = match[1].substring(0, i + 1).trim();
    logger.info({ 
        id: tweet.id, 
        user: tweet.user.screen_name, 
        code: code 
    }, 'tweet has code');
    if (code.lastIndexOf('return') !== 0)
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
            msg = '@webtaskio result: ' + body;
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

        logger.warn({ result: msg }, 'twitter response');

        twitter.postTweet({
            status: msg,
            in_reply_to_status_id: tweet.id,
        }, function (error) {
            if (error)
                logger.error(error, 'error posting to twitter');
            return callback();
        }, function (data) {
            logger.warn({ result: msg }, 'twitter response sent');
            return callback();
        });
    });
}
