feature ticket : INF-101

step 1 : setting up
1. Creating the Root package.json
Instead of me writing the file, you can initialize a Node project yourself.

Open your terminal in the root folder (/Users/rajaitarunkanaiyalal/Desktop/placement_prep/CCMMS).
Run npm init -y to generate a default package.json.
Open the newly created package.json in your editor.
To turn this into a "workspace" (which allows us to have multiple microservices share one root), add this array to your package.json:
json
"workspaces": [
  "services/*"
],
You also need to add "private": true to the top level of the JSON so npm knows not to publish the root folder.
Install concurrently so we can run all services at once. Run this in your terminal:
bash
npm install concurrently --save-dev
Finally, update the "scripts" block in your package.json to include our dev command:
json
"scripts": {
  "dev": "concurrently \"npm run dev -w services/api-gateway -w services/user-service -w services/catalog-service -w services/order-service -w services/notification-service\""
}
2. Creating the .env.example
You can create this file manually.

Create a new file named .env.example in the root folder.
In this file, you'll want to define placeholders for the cloud databases you'll provision. You can structure it however makes sense to you, but you will need variables for:
DATABASE_URL= (For PostgreSQL)
MONGODB_URI= (For MongoDB Atlas)
VALKEY_URL= (For Upstash Valkey)
RABBITMQ_URL= (For CloudAMQP)
Ports for your 5 services (e.g., USER_SERVICE_PORT=3001, CATALOG_SERVICE_PORT=3002, etc.)
A JWT_SECRET=

3. then created the services folder with 5 services
4. then do npm init in all of them
5. then install specific dependencies in workspace that they need 

# API Gateway
npm install express cors dotenv express-mongo-sanitize -w services/api-gateway
# User Service
npm install express pg dotenv -w services/user-service
# Catalog Service
npm install express mongoose dotenv -w services/catalog-service
# Order Service
npm install express pg ioredis dotenv -w services/order-service
# Notification Service
npm install express amqplib dotenv -w services/notification-service

6. now we will setup the index.js file for each microservice
7. setup for api gateway and user service done : https://chatgpt.com/share/6a649c8c-02e0-83ee-bf00-a65da92ae5c9

feature ticket : GW-102

https://chatgpt.com/share/6a6773e0-8890-83e8-a956-bab2d8e2b5ea

The Concept: API Gateway Pattern
Right now, a client (browser/mobile app) would need to know about 5 different ports (3000, 3001, 3002, 3003, 3004). That is terrible for security — you are exposing your entire internal network.

The API Gateway solves this by being the single front door. The client only ever talks to Port 3000. The gateway's job is to look at the URL path and silently forward (proxy) the request to the correct internal service.

Client                  API Gateway (3000)         Internal Services
  |                           |
  |  GET /api/v1/users/me     |
  |-------------------------->|
  |                           |----> User Service (3001)
  |                           |<---- response
  |<--------------------------|
Two Things We Need to Build
1. HTTP Proxying (http-proxy-middleware)
This is the library that does the actual "forward this request to another port" work. When the gateway sees /api/v1/users/*, it strips that prefix and sends the request to http://localhost:3001. The library handles copying headers, body, and response automatically.

2. Zero-Trust Internal Header (X-Internal-Service-Key)
This is a security layer. Since all 5 services run on the same machine (or same Docker network), a malicious actor could bypass the gateway entirely and hit http://localhost:3001 directly.

To prevent this, we:

The gateway injects a secret header X-Internal-Service-Key: <some_secret> onto every forwarded request.
Each downstream service (User, Catalog, Order) has a middleware that checks for this header. If it's missing or wrong, it responds with 403 Forbidden.
The client never knows this secret key exists.

Implementation Steps
Here is your roadmap:

Step 1: Install http-proxy-middleware in the api-gateway service:

bash
npm install http-proxy-middleware -w services/api-gateway
Step 2: Add INTERNAL_SERVICE_KEY to your .env file (just make up a long random string).

Step 3: Rewrite services/api-gateway/index.js to set up 3 proxy routes.

Step 4: Add an internalAuthMiddleware to services/user-service/index.js (and later catalog + order) that validates the header.

Go ahead and install http-proxy-middleware first! Once that's done, let me know and I'll explain exactly how to write the proxy configuration in your gateway's index.js.

16:38, 26/07/2026
16:46, 26/07/2026
Let me explain how http-proxy-middleware works before you write the code.

How createProxyMiddleware Works
When you import http-proxy-middleware, you get a function called createProxyMiddleware. You give it a target (the destination service URL) and some options, and it returns an Express middleware that handles all the forwarding for you.

javascript
const { createProxyMiddleware } = require('http-proxy-middleware');
// This creates a middleware that forwards requests to port 3001
const userProxy = createProxyMiddleware({
  target: 'http://localhost:3001',
  changeOrigin: true, // fixes the Host header so the target service doesn't get confused
  on: {
    proxyReq: (proxyReq) => {
      // This is where you INJECT the secret header onto every forwarded request
      proxyReq.setHeader('X-Internal-Service-Key', process.env.INTERNAL_SERVICE_KEY);
    }
  }
});
// Then you use it like any middleware on a specific route
app.use('/api/v1/users', userProxy);
When a request hits /api/v1/users/register, the middleware:

Takes the full path /api/v1/users/register
Appends it to the target → http://localhost:3001/api/v1/users/register
Injects the X-Internal-Service-Key header
Forwards the request and pipes the response back to the client
Your Task: Rewrite services/api-gateway/index.js
Here's the structure you need to write. The file has 4 sections:

Imports - express, cors, dotenv, and createProxyMiddleware from http-proxy-middleware
App setup - same app, PORT, middlewares as before
Create 3 proxy middlewares - one for users (→ 3001), one for catalog (→ 3002), one for orders (→ 3003). Each one injects the X-Internal-Service-Key header in the on.proxyReq callback.
Register 3 routes + the health route - mount each proxy middleware on its path using app.use()
Go ahead and write it out! The key things to figure out:

What path do you mount the user proxy on? (/api/v1/users)
What path do you mount the catalog proxy on? (/api/v1/catalog)
What path do you mount the orders proxy on? (/api/v1/orders)
Give it a shot and share what you write, and I'll verify it!

16:43, 26/07/2026
16:58
Your userProxy is written correctly! The structure is perfect.

One important thing to flag though — order of operations matters here. Notice that you create userProxy on line 11, before dotenv.config() runs on line 9. That means when createProxyMiddleware is called, process.env.INTERNAL_SERVICE_KEY is already available because dotenv runs first. ✅ Good ordering.

However, there's a subtle issue with express.json() and proxy middleware. The express.json() middleware consumes the request body (parses it into req.body). When the proxy tries to forward the raw request body downstream, it's already been consumed and the Content-Length header won't match.

The fix: Register your proxy routes before express.json(). The proxy middleware will intercept those routes before express.json() touches the body, and express.json() only applies to routes the proxy doesn't intercept (like /health).

javascript
app.use(cors());
// ✅ Register proxies FIRST (before express.json)
app.use('/api/v1/users', userProxy);
app.use('/api/v1/catalog', catalogProxy);
app.use('/api/v1/orders', ordersProxy);
// ✅ THEN register json parsing (only for non-proxied routes like /health)
app.use(express.json());
Now go ahead and finish the file! You need to:

Create catalogProxy pointing to http://localhost:3002
Create ordersProxy pointing to http://localhost:3003
Register all 3 proxy routes before express.json()
Keep the /health route at the bottom
Share what you write for the full file and I'll do a final verification before we test it!

16:58
17:01
Almost perfect! I spotted one small copy-paste bug. Look at this line:

javascript
app.use('/api/v1/catalog', userProxy);  // ❌ Bug! Points to the wrong proxy
You accidentally used userProxy for the catalog route instead of catalogProxy. So right now, any request to /api/v1/catalog would incorrectly be routed to Port 3001 (User Service) instead of Port 3002 (Catalog Service).

Fix it to:

javascript
app.use('/api/v1/catalog', catalogProxy);  // ✅ Correct
Everything else is correct:

✅ All 3 proxy middlewares created with the right targets
✅ Each one injects X-Internal-Service-Key header
✅ Proxies registered before express.json()
✅ changeOrigin: true on all of them
Once you fix that one line, move on to Step 4 — adding the internalAuthMiddleware to the User Service (and then Catalog and Order). That's the guard that rejects any request that didn't come through the gateway. Ready?

17:01
17:02
The gateway is complete. Now let's protect the downstream services.

The Concept: internalAuthMiddleware
This is a standard Express middleware function. Every request to the User Service (and later Catalog and Order) will pass through this function first, before hitting any route handler.

Here is how Express middleware works:

javascript
// Middleware signature: always (req, res, next)
const someMiddleware = (req, res, next) => {
    // Do your check...
    
    if (checkFails) {
        return res.status(403).json({ error: 'Forbidden' });
        // We return here so next() is never called
        // The request is DEAD here
    }
    
    next(); // ✅ Check passed, hand off to the next handler
};
The next() call is critical — it tells Express "I'm done, pass this request to the next middleware or route handler."

What Your Middleware Needs To Do
Read req.headers['x-internal-service-key'] from the incoming request
Compare it to process.env.INTERNAL_SERVICE_KEY from your .env
If they don't match → respond with 403 Forbidden and stop
If they do match → call next() to let the request proceed
Your Task: Write it in services/user-service/index.js
The structure you need to write at the top of the file (after your imports and pool setup, before any routes):

javascript
// Step 1: Define the middleware function
const internalAuthMiddleware = (req, res, next) => {
    // your logic here
};
// Step 2: Apply it globally to ALL routes in this service
app.use(internalAuthMiddleware);
By doing app.use(internalAuthMiddleware) without a path, it runs on every single request to the User Service — which is exactly what we want.

Give it a shot and share your code!

17:02
17:08
Good thinking, but there are two bugs here that will cause it to crash in production.

Bug 1: Header names are always lowercase in Node.js
HTTP headers are case-insensitive by spec, but Node.js normalizes all incoming header names to lowercase when it parses them. So req.headers['X-Internal-Service-Key'] will always be undefined, even when the header is present.

javascript
// ❌ Will always be undefined
req.headers['X-Internal-Service-Key']
// ✅ This is how Node.js actually stores it
req.headers['x-internal-service-key']
Bug 2: Missing return before next()
When your if condition is true, you call next() — but JavaScript doesn't stop executing the function! It continues to the res.status(403).json(...) line right after the if block.

This will cause a "Cannot set headers after they are sent" crash because next() hands off to the route handler (which sends a 200 response), and then your code tries to send a 403 on top of it.

javascript
// ❌ Your current code — next() is called, but 403 also runs
if (...) {
    next();        // hands off to route handler → sends 200
}
res.status(403).json({...}) // then THIS also tries to send a response → CRASH
// ✅ Use return to stop execution
if (...) {
    return next(); // returns immediately, 403 line is never reached
}
res.status(403).json({...}) // only runs if the if condition was false
Fixed Version
javascript
const internalAuthMiddleware = (req, res, next) => {
    if (req.headers['x-internal-service-key'] && req.headers['x-internal-service-key'] === process.env.INTERNAL_SERVICE_KEY) {
        return next(); // ✅ return stops the function here
    }
    res.status(403).json({
        error: 'forbidden'
    });
};
Fix those two things and then add app.use(internalAuthMiddleware) to your User Service before your routes. Then apply the same middleware to catalog-service and order-service too!

17:08
17:09
The middleware is now perfect! ✅

Now you need to actually register it. Add this one line to your user-service/index.js right after app.use(express.json()):

javascript
app.use(express.json());
app.use(internalAuthMiddleware); // ← add this line
This tells Express: "Run internalAuthMiddleware on every single request before any route handler."

Once you add that line, do the same thing for catalog-service and order-service:

Copy the exact same internalAuthMiddleware function into their index.js files.
Register it with app.use(internalAuthMiddleware) in both of them.
The logic is identical in all three services — each one independently verifies the secret key.

After you've done all three, restart your dev server (Ctrl+C then npm run dev) and we'll test it by:

Hitting http://localhost:3000/api/v1/users/health (through the gateway) → should return 200 ✅
Hitting http://localhost:3001/health (directly, bypassing gateway) → should return 403 Forbidden ✅
Let me know when you're ready to test!

17:09
17:13
That 403 is exactly correct and is the whole point of what you just built! 🎉

Here is why:

When you hit http://localhost:3001/health directly (via curl from your terminal), your terminal doesn't attach any special headers. So the request arrives at the User Service with no x-internal-service-key header → internalAuthMiddleware sees it, the if condition fails → 403 Forbidden.

When you hit http://localhost:3000/api/v1/users/health through the gateway, the gateway's proxyReq callback fires and injects the X-Internal-Service-Key header → the User Service receives it, the if condition passes → next() → 200 OK.

You have successfully implemented Zero-Trust internal network security. Port 3001 is now effectively invisible to the public.

GW-102 is complete! ✅

About the errors in the logs
You also have two unrelated connection reset errors:

[4] Error: read ECONNRESET — CloudAMQP's free tier drops idle connections after a short time. This is a known limitation of the free plan. We will add a reconnect loop later.
[3] [ioredis] Unhandled error event: read ECONNRESET — Same thing happening with Upstash Valkey.
These are not code bugs, just the cloud providers dropping idle TCP connections. We can handle them gracefully later when we implement proper resilience patterns.

What's next? Based on your ticket list, the natural next step would be:

USR-201: User Registration & Authentication (bcrypt password hashing, JWT generation, /register and /login routes).
Ready to start?

chat gpt : https://chatgpt.com/share/6a6744a7-6af4-83ee-99e8-c1e967ae1568

feature ticket : GW-103

Bhai mast! 😄 Ye concept pehli baar dekhne pe sabko complex lagta hai, especially Redis + middleware + async sab ek saath aa jaaye to.

Main isse **3 parts** mein samjhaunga:

1. **Concept (Real Life Example)**
2. **Syntax (Ye code likha hi kyun hai?)**
3. **Code Walkthrough (Line by Line)**

---

# Step 1 : Sabse pehle Rate Limiting hota kya hai?

Maan lo tumhare ghar mein ek security guard hai.

Rule hai:

> **Ek aadmi 1 minute mein sirf 5 baar andar aa sakta hai.**

Ab ek banda aata hai.

```
Request 1 ✅

Remaining Chances = 4
```

Fir dubara

```
Request 2 ✅

Remaining = 3
```

Fir

```
Request 3 ✅

Remaining = 2
```

Fir

```
Request 4 ✅

Remaining = 1
```

Fir

```
Request 5 ✅

Remaining = 0
```

Ab agar woh 6th baar aaya

```
❌ Nahi bhai

1 minute wait karo.
```

1 minute complete hua

```
Remaining = 5

Phirse shuru.
```

Yehi hai Rate Limiting.

---

# Step 2 : Redis ki zarurat hi kya hai?

Question:

Express ke andar variable bana dete.

```js
let count = 5;
```

Problem?

Agar server restart hua

```
count gayab.
```

Agar 3 gateway servers chal rahe ho

```
Gateway 1

count = 3

Gateway 2

count = 5

Gateway 3

count = 1
```

Sab alag alag count rakh rahe hain.

Ye galat hai.

Isliye sab ek hi jagah count rakhenge.

Wo jagah hai

```
Redis
```

Sab servers Redis se hi puchenge.

---

# Step 3 : Redis mein store kya hota hai?

Suppose tumhara IP hai

```
192.168.1.20
```

Redis mein

```
Key

rate_limit:192.168.1.20
```

Value

```
5
```

Matlab

```
Is bande ke paas 5 requests bachi hain.
```

---

# Step 4 : createRateLimiter()

Ye line dekho

```js
const createRateLimiter = (maxTokens, windowMs) => {
```

Iska matlab

```
Ek function banao

Jo batayega

Kitni requests allow hain

Aur kitne time ke liye.
```

Example

```js
createRateLimiter(100, 60000)
```

Meaning

```
100 requests

every 60 seconds
```

Dusra

```js
createRateLimiter(5,60000)
```

Meaning

```
5 requests

every 60 seconds
```

Ye reusable function hai.

---

# Step 5 : Ye function return kya kar raha hai?

```js
return async (req,res,next)=>{
```

Yahi actual middleware hai.

Matlab

```js
app.use("/orders", ordersLimiter)
```

To internally

```
ordersLimiter(req,res,next)
```

call hoga.

---

# Step 6 : Key banana

```js
const key = `rate_limit:${req.ip}`;
```

Suppose

```
req.ip

=

192.168.0.5
```

To key banegi

```
rate_limit:192.168.0.5
```

Redis mein

```
rate_limit:192.168.0.5

↓

3
```

Matlab

```
3 requests remaining.
```

---

# Step 7 : Redis se value lao

```js
const current = await redis.get(key);
```

Suppose Redis

```
rate_limit:192.168.0.5

↓

4
```

To

```
current = 4
```

---

# CASE A

```js
if(current===null)
```

Matlab

Redis mein key hi nahi mili.

Iska matlab?

Ye banda pehli baar request bhej raha hai.

Example

```
Redis

(empty)
```

Request aayi

```
192.168.0.5
```

To

Redis mein save karo

```
rate_limit:192.168.0.5

↓

4
```

Kyun 4?

Kyunki

Maximum tha

```
5
```

Aur ek request use kar chuka.

To

Remaining

```
4
```

Isi liye

```js
await redis.set(key,maxTokens-1,'PX',windowMs);
```

---

# PX kya hai?

Ye bahut important hai.

```
PX

=

Expiry in milliseconds
```

Example

```js
windowMs

=

60000
```

Matlab

```
60 seconds
```

60 second baad

Redis automatically

```
delete
```

kar dega.

To fir next request pe

```
current===null
```

ho jayega.

Aur bucket reset.

---

# CASE B

```js
if(parseInt(current)<=0)
```

Suppose

Redis

```
rate_limit:192.168.0.5

↓

0
```

Matlab

```
No tokens left.
```

To

```
HTTP 429
```

bhejo.

```js
res.status(429)
```

Matlab

```
Too Many Requests
```

---

# Retry-After

```js
res.set(
"Retry-After",
60
)
```

Matlab

Browser ko bolo

```
60 second baad try karna.
```

---

# CASE C

Suppose

Redis

```
3
```

Matlab

Abhi chances hain.

To

```js
await redis.decr(key)
```

Redis

```
3

↓

2
```

Aur request allow.

```
next()
```

---

# decr kya hai?

Ye Redis command hai.

```
Before

5
```

Command

```
decr
```

Result

```
4
```

Fir

```
4

↓

3

↓

2

↓

1

↓

0
```

Sab automatically.

---

# Atomic matlab?

Suppose ek hi time pe

100 requests aa gayi.

Agar normal JS variable hota

```
Read = 5

Read = 5

Read = 5
```

Sab gadbad.

Lekin Redis ka

```
decr
```

Atomic hai.

Matlab

```
Ek ek karke safely karega.
```

No race condition.

---

# Catch

```js
catch(err){
 next();
}
```

Question

Redis down ho gaya.

To kya sab users ko block kar doge?

Nahi.

Developer bol raha hai

```
Redis unavailable?

Chalo request jaane do.
```

Isko bolte hain

```
Fail Open
```

Yaani security feature unavailable ho to service ko band mat karo.

---

# Last Part

```js
const catalogRateLimiter =
createRateLimiter(100,60000);
```

Meaning

```
Catalog

↓

100 requests

per minute
```

Orders

```js
const ordersRateLimiter =
createRateLimiter(5,60000);
```

Meaning

```
Orders

↓

5 requests

per minute
```

Kyun?

Catalog page sab log baar baar refresh karte hain.

Orders place karna sensitive operation hai (spam ya accidental duplicate orders rokne ke liye), isliye uski limit kaafi kam rakhi hai.

---

# API Gateway Flow

```
Client
   │
   ▼
Orders Request

   │
   ▼
ordersRateLimiter

   │
   ├── Redis se current tokens check
   │
   ├── Token > 0 ?
   │          │
   │          ├── YES → decr() → next()
   │          │
   │          └── NO → 429 Too Many Requests
   │
   ▼
ordersProxy

   │
   ▼
Orders Service
```

---

## 🔥 Ek sentence mein pura code

Ye middleware har request par Redis mein **IP ke hisaab se bache hue tokens check karta hai**. Agar token bache hain to ek token kam (`decr`) karke request ko aage bhej deta hai (`next()`); agar token khatam ho gaye to **429 Too Many Requests** return karta hai. Redis key par expiry (`PX`) lagi hoti hai, isliye time window khatam hote hi bucket automatically reset ho jaati hai.

---

## 🧠 Ek chhota doubt jo shayad tumhare mind mein aane wala hai...

Tum notice karoge ki code mein **`maxTokens` kabhi increase hi nahi ho raha**, sirf `decr()` ho raha hai.

Phir 1 minute baad tokens **100 ya 5 wapas kaise ban jaate hain?**

👉 Iska jawab Redis ke **TTL (PX expiry)** mein chhupa hua hai. Ye sabse important piece hai, aur agar ye samajh aa gaya to rate limiter ka pura mechanism crystal clear ho jayega.


---

## Concept 3: NoSQL Injection Defense

MongoDB operators like `$where`, `$gt`, `$or` are dangerous in request bodies. An attacker could send:
```json
{ "username": { "$gt": "" }, "password": { "$gt": "" } }
```
This bypasses authentication by matching ALL users.

`express-mongo-sanitize` strips all keys containing `$` or `.` from `req.body`, `req.params`, and `req.query` automatically. You just need to add it as middleware.

---

## Implementation Plan

You'll create a new file in the API Gateway for the rate limiter logic, and add middleware to `api-gateway/index.js`.

**Step 1:** Install `ioredis` in the api-gateway (to talk to Upstash Valkey):
```bash
npm install ioredis -w services/api-gateway
```

**Step 2:** Create a new file `services/api-gateway/middleware/rateLimiter.js` that exports two middleware functions:
- `catalogRateLimiter` — 100 req/min per IP
- `ordersRateLimiter` — 5 req/min per JWT user ID

**Step 3:** In `api-gateway/index.js`, add `express-mongo-sanitize` and mount the rate limiters on the specific routes before the proxies.

---

Go ahead and run Step 1 (install `ioredis`), then create the `middleware/` folder and the `rateLimiter.js` file. Once you've set up the file structure, let me know and I'll explain exactly how to write the rate limiter logic!

