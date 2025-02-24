const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");

const adminValidator = async (req, res, next) => {
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
        const getAdmin = await query(
          `SELECT * FROM admin WHERE email = ? and password = ? `,
          [decode.email, decode.password]
        );
        if (getAdmin.length < 1) {
          return res.json({
            success: false,
            msg: "Invalid token found",
            token,
            logout: true,
          });
        }
        if (getAdmin[0].role === "admin") {
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

module.exports = adminValidator;
