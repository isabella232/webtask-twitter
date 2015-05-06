Run code by Twitter with webtask.io
====

This project demonstrates the use of [webtask.io](https://webtask.io) created by [Auth0](https://auth0.com) to run Node.js code submitted to the [@webtaskio](https://twitter.com/webtaskio) twitter alias by way of a tweet. 

![webtask-twitter](https://cloud.githubusercontent.com/assets/822369/7501470/0433c6d4-f3e9-11e4-818e-ed1daaee6540.png)

## How to use

Using your favorite Twitter client, send a tweet formatted as follows:

```
run @webtaskio: cb => cb(null, 'Hello, world!')
```

Moments later you should receive a response via Twitter containing the results of the execution. 

You can submit any webtask Node.js code for execution (well it needs to fit in a Tweet). Read more at https://webtask.io.

## How it works

The Twitter client in this project attaches to the user stream of [@webtaskio](https://twitter.com/webtaskio). It filters the tweets that match the syntax above. It extracts the Node.js code. It then executes the code using [webtask.io](https://webtask.io). Lastly, it sends the result of execution to you by way of a Twitter reply. 
