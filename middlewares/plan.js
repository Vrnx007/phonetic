const { query } = require("../database/dbpromise");
const { getNumberOfDaysFromTimestamp } = require("../functions/function");

const checkPlan = async (req, res, next) => {
  try {
    // if (req.owner) {
    //   req.decode.uid = req.owner.uid;
    // }

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const plan = getUser[0]?.plan;

    if (!plan) {
      return res.json({
        success: false,
        msg: "Please subscribe a plan to proceed this.",
      });
    }

    const numOfDyaLeft = getNumberOfDaysFromTimestamp(getUser[0]?.plan_expire);

    if (numOfDyaLeft < 1) {
      return res.json({
        success: false,
        msg: "Your plan was expired. Please buy a plan",
      });
    } else {
      req.plan = JSON.parse(getUser[0]?.plan);
      next();
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkContactLimit = async (req, res, next) => {
  try {
    const contact_limit = req.plan?.contact_limit;

    const getContacts = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.decode.uid,
    ]);

    if (getContacts.length >= contact_limit) {
      return res.json({
        success: false,
        msg: `Your plan allowd you to add only ${contact_limit} contacts. Delete some to add new`,
      });
    } else {
      next();
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkDialer = async (req, res, next) => {
  try {
    const plan = req.plan;
    const dialer = parseInt(plan?.dialer) > 0 ? true : false;

    if (!dialer) {
      return res.json({
        success: false,
        msg: "Your plan does not allow to use dialer",
      });
    }

    next();
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkCallBroadcast = async (req, res, next) => {
  try {
    const plan = req.plan;
    const call_broadcast = parseInt(plan?.call_broadcast) > 0 ? true : false;

    if (!call_broadcast) {
      return res.json({
        success: false,
        msg: "Your plan does not allow to use call broadcast",
      });
    }

    next();
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkMesseging = async (req, res, next) => {
  try {
    const plan = req.plan;
    const messaging = parseInt(plan?.messaging) > 0 ? true : false;

    if (!messaging) {
      return res.json({
        success: false,
        msg: "Your plan does not allow to use messaging",
      });
    }

    next();
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkAgentAccess = async (req, res, next) => {
  try {
    const plan = req.plan;
    const agent_access = parseInt(plan?.agent_access) > 0 ? true : false;

    if (!agent_access) {
      return res.json({
        success: false,
        msg: "Your plan does not allow to use agent access",
      });
    }

    next();
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkDeviceLimit = async (req, res, next) => {
  try {
    const device_limit = req.plan?.device_limit;

    const getDevices = await query(`SELECT * FROM device WHERE uid = ?`, [
      req.decode.uid,
    ]);

    if (getDevices.length >= device_limit) {
      return res.json({
        success: false,
        msg: `Your plan allowd you to add only ${device_limit} devices. Delete some to add new`,
      });
    } else {
      next();
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

module.exports = {
  checkPlan,
  checkContactLimit,
  checkDialer,
  checkCallBroadcast,
  checkMesseging,
  checkAgentAccess,
  checkDeviceLimit,
};
