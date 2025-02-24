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
} = require("../functions/function.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { getConnectedUsers } = require("../socket.js");
const { VoiceResponse } = require("twilio").twiml;
const Twilio = require("twilio");
const { checkPlan, checkDialer } = require("../middlewares/plan.js");

router.post(
  "/gen_twilio_token",
  validateUser,
  checkPlan,
  checkDialer,
  async (req, res) => {
    try {
      const { id, identity } = req.body;
      if (!id) {
        return res.json({ msg: "Please provide device id" });
      }

      const getDevice = await query(`SELECT * FROM device WHERE id = ?`, [id]);

      if (getDevice.length < 1) {
        return res.json({ msg: "Device not found" });
      }

      const device = getDevice[0];

      await query(`UPDATE device SET connected_id = ? WHERE id = ?`, [
        identity,
        device.id,
      ]);

      const config = {
        accountSid: device?.sid,
        apiKey: device?.api_key,
        apiSecret: device?.api_secret,
        outgoingApplicationSid: device?.outgoing_app_sid,
        incomingAllow: true,
      };

      const token = voiceToken({ identity, config });

      res.json({ data: token, success: true });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// this is for outgoing webhook
router.post("/voice/:device", async (req, res) => {
  try {
    const { To } = req.body;
    const { device } = req.params;

    // Get the device from the database
    const getDevice = await query(`SELECT * FROM device WHERE device_id = ?`, [
      device,
    ]);

    if (getDevice.length < 1) {
      // If no device is found, create a TwiML response with a Say verb
      const response = new VoiceResponse();
      response.say(
        "We are sorry, but no device was found for the ID you provided. Please try again later."
      );

      // Send the TwiML response
      res.type("text/xml");
      return res.send(response.toString());
    }

    const deviceDetails = getDevice[0];
    const fromNumber = normalizeMobileNumber(deviceDetails?.number);

    const response = new VoiceResponse();
    const dial = response.dial({ callerId: fromNumber });
    dial.number(To);
    res.set("Content-Type", "text/xml");
    res.send(response.toString());
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// ading call in database
router.post("/add_call_log", validateUser, async (req, res) => {
  try {
    const { device_id, call_id, mobile_to, mobile_from, status, route } =
      req.body;

    await query(
      `INSERT INTO call_log (device_id, uid, call_id, mobile_to, mobile_from, status, call_duration, route) VALUES (?,?,?,?,?,?,?,?)`,
      [
        device_id,
        req.decode.uid,
        call_id,
        mobile_to,
        mobile_from,
        status,
        "-",
        route || "OUTGOING",
      ]
    );

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// udpate call log
router.post("/update_call_log", validateUser, async (req, res) => {
  try {
    const { timer, status, call_id } = req.body;

    await query(
      `UPDATE call_log SET call_duration = ?, status = ? WHERE call_id = ?`,
      [timer, status, call_id]
    );

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get calls by device id
router.post("/get_calls_by_device", validateUser, async (req, res) => {
  try {
    const { deviceId } = req.body;
    const data = await query(`SELECT * FROM call_log WHERE device_id = ?`, [
      deviceId,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del a log
router.post("/del_a_log", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM call_log WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({ success: true, msg: "The call log was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// clear all call logs
router.post("/del_call_logs", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`DELETE FROM call_log WHERE device_id = ?`, [id]);
    res.json({ msg: "Call logs has been deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

module.exports = router;
