const jwt = require('jsonwebtoken');
const user = require('models/User');

// verify jwt Token

const protect = async(req,res,next) => {

    let token;
}

if(
    req.headers.authorization && 
    req.headers.authorization.startsWith('bearer')
) {
        try{
            token = req.headers.authorization.split('')[1];
            const encoded = jwt.verify(token,process.env.JWT_SECRET);

            req.user = await UserActivation.findById(decoded.id).select('-password');
            if(!req.user){

                return res.status(401).json({message: 'User not found' });
            }

            return next();
        }catch(error){

            return res.status(401).json({message: 'Not authorized, no token'});
        }
    };

    // admin guard middleware

    const adminOnly = (req,res, next) => {

        if(req.user && req.user.role === 'admin') {

            next();
        }else{

            res.status(403).json({message: 'Access denied: Admin privilages required'});
        }
    };

    module.exports = {protect, adminOnly };
