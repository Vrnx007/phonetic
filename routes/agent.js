const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const adminValidator = require("../middlewares/admin.js");
const moment = require("moment");
const { isValidEmail, getPlanDetails } = require("../functions/function.js");
const validateUser = require("../middlewares/user.js");
const validateAgent = require("../middlewares/agent.js");
const { checkPlan, checkAgentAccess } = require("../middlewares/plan.js");

// adding agent
router.post(
  "/add_agent",
  validateUser,
  checkPlan,
  checkAgentAccess,
  async (req, res) => {
    try {
      const { name, password, email, mobile, comments } = req.body;

      if (!name || !password || !email || !mobile) {
        return res.json({
          msg: "Please fill all the details",
        });
      }

      if (!isValidEmail(email)) {
        return res.json({ msg: "Please enter a valid email" });
      }

      // check if already
      const getUser = await query(`SELECT * FROM agents WHERE email = ?`, [
        email?.toLowerCase(),
      ]);

      if (getUser.length > 0) {
        return res.json({
          msg: "This email is already used by you or someone else on the platform, Please choose another email",
        });
      }

      const hashPass = await bcrypt.hash(password, 10);

      const uid = randomstring.generate();

      await query(
        `INSERT INTO agents (owner_uid, uid, email, password, name, mobile, comments) VALUES (
              ?,?,?,?,?,?,?
          )`,
        [
          req.decode.uid,
          uid,
          email?.toLowerCase(),
          hashPass,
          name,
          mobile,
          comments,
        ]
      );

      res.json({
        msg: "Agent account was created",
        success: true,
      });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// get all agents
router.get(
  "/get_my_agents",
  validateUser,
  checkPlan,
  checkAgentAccess,
  async (req, res) => {
    try {
      const data = await query(`SELECT * FROM agents WHERE owner_uid = ?`, [
        req.decode.uid,
      ]);

      res.json({ data, success: true });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// change agent activeness
router.post("/change_agent_activeness", validateUser, async (req, res) => {
  try {
    const { agentUid, activeness } = req.body;

    await query(`UPDATE agents SET is_active = ? WHERE uid = ?`, [
      activeness ? 1 : 0,
      agentUid,
    ]);

    res.json({
      success: true,
      msg: "Success",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del user
router.post("/del_agent", validateUser, async (req, res) => {
  try {
    const { uid } = req.body;
    await query(`DELETE FROM agents WHERE uid = ? AND owner_uid = ?`, [
      uid,
      req.decode.uid,
    ]);

    res.json({
      success: true,
      msg: "Agent was deleted",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update agent profile
router.post("/update_agent_profile", validateUser, async (req, res) => {
  try {
    const { email, name, mobile, newPas, uid } = req.body;

    if (!email || !name || !mobile) {
      return res.json({
        msg: "You can not remove any detail of agent",
      });
    }

    if (newPas) {
      const hasPas = await bcrypt.hash(newPas, 10);
      await query(
        `UPDATE agents SET email = ?, name = ?, mobile = ?, password = ? WHERE uid = ?`,
        [email, name, mobile, hasPas, uid]
      );
    } else {
      await query(
        `UPDATE agents SET email = ?, name = ?, mobile = ? WHERE uid = ?`,
        [email, name, mobile, uid]
      );
    }

    res.json({ msg: "Agent profile was updated", success: true });
  } catch (err) {
    console.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// auto login agent
router.post(
  "/auto_agent_login",
  validateUser,
  checkPlan,
  checkAgentAccess,
  async (req, res) => {
    try {
      const { uid } = req.body;
      const agentFind = await query(`SELECT * FROM agents WHERE uid = ?`, [
        uid,
      ]);

      const token = sign(
        {
          uid: agentFind[0].uid,
          role: "agent",
          password: agentFind[0].password,
          email: agentFind[0].email,
          owner_uid: agentFind[0]?.owner_uid,
        },
        process.env.JWTKEY,
        {}
      );

      res.json({ token, success: true });
    } catch (err) {
      console.log(err);
      res.json({ msg: "something went wrong", err });
    }
  }
);

// login agent
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.json({
        success: false,
        msg: "Please provide email and password",
      });
    }

    // check for user
    const agentFind = await query(`SELECT * FROM agents WHERE email = ?`, [
      email,
    ]);
    if (agentFind.length < 1) {
      return res.json({ msg: "Invalid credentials" });
    }

    const compare = await bcrypt.compare(password, agentFind[0].password);

    if (!compare) {
      return res.json({ msg: "Invalid credentials" });
    } else {
      const getOwnerPlan = await getPlanDetails(agentFind[0].owner_uid);

      if (!getOwnerPlan) {
        return res.json({
          msg: "You dont have a plan, Please contact the owner of the account",
        });
      } else if (parseInt(getOwnerPlan?.agent_access) < 1) {
        return res.json({
          msg: "Your owner has not allowed you to access the account",
        });
      }

      if (parseInt(agentFind[0].is_active) < 1) {
        return res.json({
          msg: "Your account is disabled, Please contact to your owner",
        });
      }

      const token = sign(
        {
          uid: agentFind[0].uid,
          role: "agent",
          password: agentFind[0].password,
          email: agentFind[0].email,
          owner_uid: agentFind[0]?.owner_uid,
        },
        process.env.JWTKEY,
        {}
      );
      res.json({
        success: true,
        token,
      });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get me agent
router.get("/get_me", validateAgent, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM agents WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data: data[0], success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

module.exports = router;
