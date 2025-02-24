const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const adminValidator = require("../middlewares/admin.js");
const moment = require("moment");
const { updateUserPlan } = require("../functions/function.js");

// add a plan
router.post("/add_plan", adminValidator, async (req, res) => {
  try {
    const {
      title,
      is_trial,
      price,
      price_crossed,
      short_des,
      dialer,
      call_broadcast,
      messaging,
      phonebook_limit,
      agent_access,
      device_limit,
      days,
    } = req.body;

    if (!title || !short_des) {
      return res.json({ success: false, msg: "Please fill all the fields" });
    }

    if (!is_trial) {
      if (!price || !price_crossed) {
        return res.json({ success: false, msg: "Please fill the price" });
      }
    }

    if (parseInt(days) < 1 && !is_trial) {
      return res.json({ msg: "Days should be greater than 0", success: false });
    }

    await query(`insert into plan set ?`, {
      title,
      is_trial,
      price,
      price_crossed,
      short_des,
      dialer,
      call_broadcast,
      messaging,
      phonebook_limit,
      agent_access,
      device_limit,
      days,
    });

    res.json({ success: true, msg: "Plan added successfully" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get all plans
router.get("/get_plans", async (req, res) => {
  try {
    const data = await query(`SELECT * FROM plan`, []);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del a plan
router.post("/del_plan", adminValidator, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`delete from plan where id = ?`, [id]);

    res.json({ success: true, msg: "Plan deleted successfully" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update plan
router.post("/update_plan", adminValidator, async (req, res) => {
  try {
    const { plan, uid } = req.body;

    if (!plan || !uid) {
      return res.json({ success: false, msg: "Invalid input provided" });
    }

    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan?.id]);
    if (getPlan.length < 1) {
      return res.json({ success: false, msg: "Invalid plan found" });
    }

    await updateUserPlan(getPlan[0], uid);

    res.json({ success: true, msg: "User plan was updated" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

module.exports = router;
