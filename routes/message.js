const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const {
  isValidEmail,
  getServiceKeys,
  isValidJson,
  extractHostname,
  normalizeMobileNumber,
  objectToCustomString,
  voiceToken,
  sendTwilioSms,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { getConnectedUsers } = require("../socket.js");
const { checkPlan, checkMesseging } = require("../middlewares/plan.js");

router.get("/hey", async (req, res) => {
  res.send("hey");
});

router.post("/msg/:device", async (req, res) => {
  try {
    const { device } = req.params;
    const msg = req.body;

    if (device) {
      const getDevice = await query(
        `SELECT * FROM device WHERE device_id = ?`,
        [device]
      );
      if (getDevice?.length > 0) {
        await query(
          `INSERT INTO messages (device_id, uid, body, msg_from, msg_to, route, recipient, twilio_number) VALUES (?,?,?,?,?,?,?,?)`,
          [
            device,
            getDevice[0]?.uid,
            msg?.Body,
            msg?.From,
            msg?.To,
            "INCOMING",
            msg?.From,
            msg?.To,
          ]
        );
      }
    }
    res.send("OK");
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// send sms
router.post(
  "/send_sms",
  validateUser,
  checkPlan,
  checkMesseging,
  async (req, res) => {
    try {
      const { deviceId, to, body } = req.body;

      if (!body || !to || !deviceId) {
        return res.json({
          msg: "Please fill mobile number and sms text to send",
        });
      }

      const getDevice = await query(
        `SELECT * FROM device WHERE device_id = ? AND uid = ?`,
        [deviceId, req.decode.uid]
      );

      if (getDevice?.length < 1) {
        return res.json({ msg: "Device not found" });
      }

      const device = getDevice[0];

      const resp = await sendTwilioSms({
        accountSid: device?.sid,
        authToken: device?.token,
        body,
        from: `+${normalizeMobileNumber(device?.number)}`,
        to: `+${normalizeMobileNumber(to)}`,
      });

      if (resp.success) {
        await query(
          `INSERT INTO messages (device_id, uid, body, msg_from, msg_to, route, recipient, twilio_number) VALUES (?,?,?,?,?,?,?,?)`,
          [
            deviceId,
            req.decode.uid,
            body,
            `+${normalizeMobileNumber(device?.number)}`,
            `+${normalizeMobileNumber(to)}`,
            "OUTGOING",
            `+${normalizeMobileNumber(to)}`,
            `+${normalizeMobileNumber(device?.number)}`,
          ]
        );
      }

      console.log(resp);

      res.json(resp);
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// getting messages
router.get(
  "/get_sms",
  validateUser,
  checkPlan,
  checkMesseging,
  async (req, res) => {
    try {
      const { important, trash, deviceId, all } = req.query;

      let data;

      if (!deviceId) {
        return res.json({ msg: "invalid request" });
      }

      if (parseInt(all)) {
        data = await query(
          `SELECT * FROM messages WHERE device_id = ? AND uid = ? AND trash = ? AND important = ?`,
          [
            deviceId,
            req.decode.uid,
            parseInt(trash) ? 1 : 0,
            parseInt(important) ? 1 : 0,
          ]
        );
      } else {
        data = await query(
          `SELECT * FROM messages WHERE device_id = ? AND uid = ? AND trash = ? AND important = ? AND route = ?`,
          [
            deviceId,
            req.decode.uid,
            parseInt(trash) ? 1 : 0,
            parseInt(important) ? 1 : 0,
            "INCOMING",
          ]
        );
      }

      res.json({ success: true, data });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// move msg to trash
router.post("/move_sms_trash", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`UPDATE messages SET trash = ? WHERE id = ? AND uid = ?`, [
      1,
      id,
      req.decode.uid,
    ]);

    res.json({ msg: "Sms moved to trash", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// move msg to inbox
router.post("/move_sms_inbox", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`UPDATE messages SET trash = ? WHERE id = ? AND uid = ?`, [
      1,
      id,
      req.decode.uid,
    ]);

    res.json({ msg: "Sms moved to trash", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del a sms
router.post("/del_sms", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM messages WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ msg: "SMS was deleted", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

module.exports = router;
