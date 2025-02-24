const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");

const validateAgent = async (req, res, next) => {
  try {
    const token = req.get("Authorization");
    if (!token) {
      return res.json({ msg: "No token found", token: token, logout: true });
    }

    jwt.verify(token.split(" ")[1], process.env.JWTKEY, async (err, decode) => {
      if (err) {
        return res.json({
          success: 0,
          msg: "Invalid token found, 499",
          token,
          logout: true,
        });
      } else {
        const getAgent = await query(
          `SELECT * FROM agents WHERE email = ? and password = ? `,
          [decode.email, decode.password]
        );
        if (getAgent.length < 1) {
          return res.json({
            success: false,
            msg: "Invalid token found, 480",
            token,
            logout: true,
          });
        }

        if (getAgent[0]?.is_active < 1) {
          return res.json({
            msg: "You are an inactive agent.",
            logout: true,
            success: false,
          });
        }

        // getting owner
        const getOwner = await query(`SELECT * FROM user WHERE uid = ?`, [
          getAgent[0]?.owner_uid,
        ]);

        if (getOwner.length < 1) {
          return res.json({
            msg: "Agent Owner not found",
            success: false,
          });
        }

        if (getAgent[0].role === "agent") {
          req.owner = getOwner[0];
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

module.exports = validateAgent;
