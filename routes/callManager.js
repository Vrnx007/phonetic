const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const {
  isValidEmail,
  getServiceKeys,
  isValidJson,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { getConnectedUsers } = require("../socket.js");

// get device
router.get("/get_device", validateUser, async (req, res) => {
  try {
    let data = await query(`SELECT * FROM device WHERE uid = ?`, [
      req.decode.uid,
    ]);

    data = data.map((x) => ({
      ...x,
      webhookUrl: `${process.env.BACKURI}/api/ivr/gather/${x.device_id}`,
      ivr: x.ivr ? JSON.parse(x.ivr) : { active: false, flow: {} },
      ivr_out: x.ivr_out ? JSON.parse(x.ivr_out) : { active: false, flow: {} },
      webhookUrlOut: `${process.env.BACKURI}/api/ivr/out/gather/${x.device_id}`,
    }));

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

module.exports = router;
