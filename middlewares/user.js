const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");

const validateUser = async (req, res, next) => {
  try {
    const token = req.get("Authorization");
    if (!token) {
      return res.json({ msg: "No token found", token: token, logout: true });
    }

    jwt.verify(token.split(" ")[1], process.env.JWTKEY, async (err, decode) => {
      if (err) {
        return res.json({
          success: 0,
          msg: "Invalid token found",
          token,
          logout: true,
        });
      } else {
        const getUser = await query(
          `SELECT * FROM user WHERE email = ? and password = ? `,
          [decode.email, decode.password]
        );

        if (getUser.length < 1) {
          return res.json({
            success: false,
            msg: "Invalid token found",
            token,
            logout: true,
          });
        }
        if (getUser[0].role === "user") {
          req.decode = decode;
          next();
        } else {
          return res.json({
            success: 0,
            msg: "Unauthorized token",
            token: token,
            logout: true,
          });
        }
      }
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

module.exports = validateUser;
