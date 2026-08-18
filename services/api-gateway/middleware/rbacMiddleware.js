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
    if (req.user && req.user.clubId) {
        req.headers['x-club-id'] = req.user.clubId;
    }
    return next();
}

module.exports = { requireRoles, injectClubId };