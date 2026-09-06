const requireRoles = (...allowedRoles) => {
    // basically this is a factory of middleware that creates middleware function based on the input
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthenticated user'
            })
        }

        const { role } = req.user;

        if (role == 'SUPER_ADMIN') {
            return next();
        }

        if (!allowedRoles.includes(role)) {
            return res.status(403).json({
                error: `Access denied. Required role : ${allowedRoles.join(' or ')}`
            })
        }

        return next();
    }
}

const injectClubId = (req, res, next) => {
    if (req.user) {
        // Trusted, gateway-derived role — downstream services use this to decide
        // whether a request may supply its own clubId (SUPER_ADMIN) or must use
        // the one tied to their account (CLUB_ADMIN). Never sourced from the client directly.
        req.headers['x-user-role'] = req.user.role;

        if (req.user.clubId) {
            req.headers['x-club-id'] = req.user.clubId;
        }
    }
    return next();
}

module.exports = { requireRoles, injectClubId };