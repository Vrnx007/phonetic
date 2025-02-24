const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const {
  isValidEmail,
  getServiceKeys,
  isValidJson,
  normalizeMobileNumber,
  voiceToken,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const validateAgent = require("../middlewares/agent.js");
const { getConnectedUsers } = require("../socket.js");

// adding call force task
router.post("/add_force_task", validateUser, async (req, res) => {
  try {
    const { phonebook, title, short_des, device } = req.body;
    const taskId = randomstring.generate(6);

    if (!phonebook?.id || !title || !short_des || !device?.device_id) {
      return res.json({ msg: "Please fill details" });
    }

    const getDevice = await query(
      `SELECT * FROM device WHERE device_id = ? AND uid = ?`,
      [device?.device_id, req.decode.uid]
    );

    if (getDevice?.length < 1) return res.json({ msg: "Invaid device found" });

    const deviceData = getDevice[0];

    const getContact = await query(
      `SELECT * FROM contact WHERE phonebook_id = ?`,
      [phonebook?.phonebook_id]
    );

    if (getContact?.length > 0) {
      const valuesArr = getContact.map((item) => [
        req.decode.uid,
        taskId,
        `+${normalizeMobileNumber(deviceData?.number)}`,
        JSON.stringify(item),
        `+${normalizeMobileNumber(item?.mobile)}`,
        "INITIATED",
      ]);

      await query(
        `INSERT INTO call_force_log (uid, task_id, call_from, contact_json, call_to, status) VALUES ?`,
        [valuesArr]
      );
    }

    await query(
      `INSERT INTO call_force_task (uid, title, short_des, task_id, device, status) VALUES (?,?,?,?,?,?)`,
      [
        req.decode.uid,
        title,
        short_des,
        taskId,
        JSON.stringify(deviceData),
        "INITIATED",
      ]
    );

    res.json({ success: true, msg: "the work force task was added" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get my call force
router.get("/get_call_force", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM call_force_task WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del a single log
router.post("/del_call_force_log", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    console.log(req.body);
    await query(`DELETE FROM call_force_log WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ success: true, msg: "The log was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del the task
router.post("/del_task", validateUser, async (req, res) => {
  try {
    const { task_id } = req.body;

    await query(`DELETE FROM call_force_task WHERE task_id = ? AND uid = ?`, [
      task_id,
      req.decode.uid,
    ]);

    await query(`DELETE FROM call_force_log WHERE task_id = ? AND uid = ?`, [
      task_id,
      req.decode.uid,
    ]);

    res.json({ success: true, msg: "The Call force task was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get logs by call force id
router.post("/get_log_by_id", validateUser, async (req, res) => {
  try {
    const { taskId } = req.body;

    const data = await query(`SELECT * FROM call_force_log WHERE task_id = ?`, [
      taskId,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update call force for agent
router.post("/update_call_task_agent", validateUser, async (req, res) => {
  try {
    const { callForce, id } = req.body;

    if (!callForce)
      return res.json({ msg: "Please selecte a call force task" });

    await query(`UPDATE agents SET call_force = ? WHERE id = ?`, [
      callForce,
      id,
    ]);

    res.json({ success: true, msg: "Agent task was updated" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get device token
router.post("/get_device_token", validateAgent, async (req, res) => {
  try {
    const { uid, owner_uid } = req.decode;
    const { identity } = req.body;
    const [agent] = await query(`SELECT * FROM agents WHERE uid = ?`, [uid]);

    if (!agent || !identity) {
      return res.json({ msg: "Invalid agent found" });
    }

    const assignedCallForce = agent?.call_force
      ? JSON.parse(agent?.call_force)
      : {};

    if (!assignedCallForce?.device) {
      return res.json({
        msg: "There is no valid assigned call force task found",
      });
    }

    const assignedDevice = assignedCallForce?.device
      ? JSON.parse(assignedCallForce?.device)
      : {};

    if (!assignedDevice?.device_id) {
      return res.json({
        msg: "We could not find a valid assigned call force task",
      });
    }

    const [device] = await query(
      `SELECT * FROM device WHERE device_id = ? AND uid = ?`,
      [assignedDevice?.device_id, owner_uid]
    );

    if (!device) {
      return res.json({
        msg: "The device is assigned to your call force task is no longer available.",
      });
    }

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

    res.json({ data: token, success: true, device });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get one call
router.post("/get_task_call", validateAgent, async (req, res) => {
  try {
    const { task_id } = req.body;
    const { owner_uid } = req.decode;
    if (!task_id) return res.json({ msg: "Task ID missing" });

    const [callForce] = await query(
      `SELECT * FROM call_force_task WHERE task_id = ? AND uid = ?`,
      [task_id, owner_uid]
    );

    if (!callForce) {
      return res.json({ msg: "The task looks no longer valid" });
    }

    const [getLog] = await query(
      `SELECT * FROM call_force_log WHERE task_id = ? AND uid = ? AND status = ? LIMIT 1`,
      [task_id, owner_uid, "INITIATED"]
    );

    if (!getLog) {
      return res.json({ msg: "There is no call found to make" });
    }

    const deviceData = callForce?.device ? JSON.parse(callForce?.device) : {};

    if (!deviceData?.device_id)
      return res.json({
        msg: "There is no device attached to this task",
      });

    const [device] = await query(
      `SELECT * FROM device WHERE device_id = ? AND uid  = ?`,
      [deviceData?.device_id, owner_uid]
    );

    if (!device)
      return res.json({
        msg: "It looks the device which is assigned to this task is no longer active",
      });

    res.json({ success: true, data: getLog });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update call log
router.post("/update_call_log", validateAgent, async (req, res) => {
  try {
    const { agent_comment, id, call_duration } = req.body;

    if (!id || !call_duration) return res.json({ msg: "Invalid request" });

    if (!agent_comment)
      return res.json({ msg: "Please fill your call comments" });

    const [agent] = await query(`SELECT * FROM agents WHERE uid = ?`, [
      req.decode.uid,
    ]);

    await query(
      `UPDATE call_force_log SET agent_comments = ?, call_duration = ?, agent = ?, status = ? WHERE id = ?`,
      [agent_comment, call_duration, JSON.stringify(agent), "COMPLETED", id]
    );

    res.json({ success: true, msg: "Call marked as completed" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// add log for incoming
router.post("/insert_incoming_call", validateAgent, async (req, res) => {
  try {
    const { sid, call_from, call_to, deviceId } = req.body;
    const { owner_uid, uid } = req.decode;

    console.log(req.body);

    if (sid && call_from && call_to && deviceId) {
      const [device] = await query(
        `SELECT * FROM device WHERE device_id = ? AND uid = ?`,
        [deviceId, owner_uid]
      );
      const [agent] = await query(`SELECT * FROM agents WHERE uid = ?`, [uid]);
      if (device) {
        await query(
          `INSERT INTO agent_incoming (uid, sid, owner_uid, call_from, call_to, device, agent) VALUES (?,?,?,?,?,?,?)`,
          [
            uid,
            sid,
            owner_uid,
            call_from,
            call_to,
            JSON.stringify(device),
            JSON.stringify(agent),
          ]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update incoming call
router.post("/update_incoming_call", validateAgent, async (req, res) => {
  try {
    const { sid, call_duration, agent_comment } = req.body;
    const { uid } = req.decode;

    if (sid && call_duration && agent_comment) {
      await query(
        `UPDATE agent_incoming SET duration = ?, agent_comments = ? WHERE sid = ? AND uid = ?`,
        [call_duration, agent_comment, sid, uid]
      );
    }

    res.json({ success: true, msg: "The incoming call was updated" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// agent incoming calls
router.get("/agent_incoming_calls", validateUser, async (req, res) => {
  try {
    const data = await query(
      `SELECT * FROM agent_incoming WHERE owner_uid = ?`,
      [req.decode.uid]
    );

    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del an incoming call record
router.post("/del_incoming_agent_record", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM agent_incoming WHERE id = ?`, [id]);
    res.json({ success: true, msg: "The incoming call record was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

module.exports = router;
