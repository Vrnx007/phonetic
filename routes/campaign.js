const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const {
  isValidEmail,
  getServiceKeys,
  isValidJson,
  normalizeMobileNumber,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { getConnectedUsers } = require("../socket.js");
const { checkPlan, checkCallBroadcast } = require("../middlewares/plan.js");
const { VoiceResponse } = require("twilio").twiml;

// add new campaign
router.post(
  "/add_new",
  validateUser,
  checkPlan,
  checkCallBroadcast,
  async (req, res) => {
    try {
      const { title, device_id, phonebook, schedule } = req.body;

      if (!title || !device_id || !phonebook || !schedule) {
        return res.json({ msg: "Please fill all the fields" });
      }

      const campaignId = randomstring.generate(6);

      const scheduleDate = new Date(schedule);

      // getting phonebook numbers
      const phoneNumbers = await query(
        `SELECT * FROM contact WHERE phonebook_id = ?`,
        [phonebook]
      );

      if (phoneNumbers?.length < 1) {
        return res.json({
          msg: "The phonebook you selecetd does not contain any phone number in it",
        });
      }

      // getting phonebook json
      const phoneBookJson = await query(
        `SELECT * FROM phonebook WHERE phonebook_id = ?`,
        [phonebook]
      );

      if (phoneBookJson?.length < 1) {
        return res.json({ msg: "Invalid phonebook found" });
      }

      // getting device
      const getDevice = await query(
        `SELECT * FROM device WHERE device_id = ?`,
        [device_id]
      );

      if (getDevice?.length < 1) {
        return res.json({
          msg: "Invalid device found. Please check your device",
        });
      }

      // creating campaign log
      const campaignLogs = phoneNumbers.map((i, key) => [
        req.decode.uid,
        campaignId,
        JSON.stringify(getDevice[0]),
        `+${normalizeMobileNumber(i.mobile)}`,
        `+${normalizeMobileNumber(getDevice[0]?.number)}`,
        JSON.stringify(i),
        key === 0 ? "CALLING" : "INITIATED",
      ]);

      await query(
        `INSERT INTO call_campaign_log (
      uid,
      broadcast_id,
      device,
      call_to,
      call_from,
      variables,
      status
      ) VALUES ?`,
        [campaignLogs]
      );

      await query(
        `INSERT INTO call_campaign (campaign_id, uid, title, device_id, phonebook, status, schedule) VALUES (?,?,?,?,?,?,?)`,
        [
          campaignId,
          req.decode.uid,
          title,
          JSON.stringify(getDevice[0]),
          JSON.stringify(phoneBookJson[0]),
          "INITIATED",
          scheduleDate,
        ]
      );

      res.json({ msg: "The campaign was added", success: true });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// get my campaign
router.get("/get_my_campaign", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM call_campaign WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({ data: data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get log by campaign
router.post("/get_logs", validateUser, async (req, res) => {
  try {
    const { campaign_id } = req.body;

    if (!campaign_id) {
      return res.json({ msg: "Please provide campaign ID" });
    }

    const data = await query(
      `SELECT * FROM call_campaign_log WHERE broadcast_id = ?`,
      [campaign_id]
    );

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del a broadcast
router.post("/del_broadcast", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM call_campaign WHERE campaign_id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    await query(
      `DELETE FROM call_campaign_log WHERE broadcast_id = ? AND uid = ?`,
      [id, req.decode.uid]
    );

    res.json({ msg: "Campaign was deleted", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del broad log
router.post("/del_broadcast_log", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM call_campaign_log WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ success: true, msg: "Log was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// call broadcast route
router.post("/ring", async (req, res) => {
  try {
    const { CallStatus } = req.body;
    const { device, outgoing } = req.query;

    console.log({ query: req.query });

    const twiml = new VoiceResponse();

    if (CallStatus === "in-progress") {
      twiml.pause({ length: 1 });
      twiml.redirect(
        `${process.env.BACKURI}/api/ivr/gather/${device}?outgoing=${outgoing}`
      );
    }
    if (CallStatus === "completed") {
      console.log("Call was completed");
    }

    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Error initiating call:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
