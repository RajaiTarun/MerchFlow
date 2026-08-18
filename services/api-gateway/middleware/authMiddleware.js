const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    // get the authorization header from the request first, we have our jwt token in there
    const authHeader = req.headers.authorization;

    // if there is no token, or the token does not start with bearer then there is an error
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Authorization token required'
        })
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // this gives us the jwt token with all the needed info
        req.user = decoded;
        return next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired please login again'
            })
        }

        return res.status(401).json({
            error: 'Invalid token'
        })
    }
}

module.exports = authMiddleware;