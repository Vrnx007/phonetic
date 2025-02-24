const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const {
  isValidEmail,
  getServiceKeys,
  isValidJson,
  areMobileNumbersFilled,
  parseCSVFile,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { getConnectedUsers } = require("../socket.js");
const { checkPlan, checkContactLimit } = require("../middlewares/plan.js");

// add new phonebook
router.post(
  "/add_phonebook",
  validateUser,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      const { name } = req.body;

      if (!name) {
        return res.json({ msg: "Please enter phonebook name" });
      }

      // checking existing
      const getPhonebook = await query(
        `SELECT * FROM phonebook WHERE name = ? AND uid = ?`,
        [name, req.decode.uid]
      );

      if (getPhonebook.length > 0) {
        return res.json({ msg: "Please enter a unique phonebook name" });
      }

      const phonebookId = randomstring.generate(5);

      await query(
        `INSERT INTO phonebook (name, uid, phonebook_id) VALUES (?,?,?)`,
        [name, req.decode.uid, phonebookId]
      );

      res.json({ msg: "Phonebook was added", success: true });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// getting my phonebook
router.get("/get_my_phonebook", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM phonebook WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// add single contact
router.post(
  "/add_single_contact",
  validateUser,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      const { id, phonebook_name, mobile, name, var1, var2, var3, var4, var5 } =
        req.body;

      if (!mobile) {
        return res.json({ success: false, msg: "Mobile number is required" });
      }

      await query(
        `INSERT INTO contact (uid, phonebook_id, phonebook_name, name, mobile, var1, var2, var3, var4, var5) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          req.decode.uid,
          id,
          phonebook_name,
          name,
          mobile,
          var1,
          var2,
          var3,
          var4,
          var5,
        ]
      );

      res.json({ success: true, msg: "Contact was inserted" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      console.log(err);
    }
  }
);

// import contcats
router.post(
  "/import_contacts",
  validateUser,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      if (!req.files || Object.keys(req.files).length === 0) {
        return res.json({ success: false, msg: "No files were uploaded" });
      }

      const { id, phonebook_name } = req.body;

      const csvData = await parseCSVFile(req.files.file.data);
      if (!csvData) {
        return res.json({ success: false, msg: "Invalid CSV provided" });
      }

      const cvalidateMobile = areMobileNumbersFilled(csvData);
      if (!cvalidateMobile) {
        return res.json({
          msg: "Please check your CSV there one or more mobile not filled",
          csvData,
        });
      }

      // Flatten the array of objects into an array of values
      const values = csvData.map((item) => [
        req.decode.uid, // assuming uid is available in each item
        id,
        phonebook_name,
        item.name,
        item.mobile,
        item.var1,
        item.var2,
        item.var3,
        item.var4,
        item.var5,
      ]);

      // Execute the query
      await query(
        `INSERT INTO contact (uid, phonebook_id, phonebook_name, name, mobile, var1, var2, var3, var4, var5) VALUES ?`,
        [values]
      );

      res.json({ success: true, msg: "Contacts were inserted" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      console.log(err);
    }
  }
);

// get my contacts
router.get("/get_my_contacts", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// dele contcats
router.post("/del_contacts", validateUser, async (req, res) => {
  try {
    await query(`DELETE FROM contact WHERE id IN (?)`, [req.body.selected]);
    res.json({ success: true, msg: "Contact(s) was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

module.exports = router;
