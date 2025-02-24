const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const {
  isValidEmail,
  getFileExtension,
  writeJsonToFile,
  deleteFileIfExists,
  readJsonFromFile,
  makeRequest,
} = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");

router.post("/add_new", validateUser, async (req, res) => {
  try {
    const { title, nodes, edges, flowId } = req.body;
    if (!title) {
      return req.json({
        success: false,
        msg: "Please give a title to the flow",
      });
    }

    console.log({ title });

    if (!nodes || !edges || !flowId) {
      return res.json({ success: false, msg: "Nodes and Edges are required" });
    }

    // checking existing
    const checkExisted = await query(`SELECT * FROM flow WHERE flow_id = ?`, [
      flowId,
    ]);

    const nodepath = `${__dirname}/../flow-json/nodes/${req.decode.uid}/${flowId}.json`;
    const edgepath = `${__dirname}/../flow-json/edges/${req.decode.uid}/${flowId}.json`;

    await writeJsonToFile(nodepath, nodes);
    await writeJsonToFile(edgepath, edges);

    if (checkExisted.length > 0) {
      await query(`UPDATE flow SEt title = ? WHERE flow_id = ?`, [
        title,
        flowId,
      ]);
    } else {
      await query(`INSERT INTO flow (uid, flow_id, title) VALUES (?,?,?)`, [
        req.decode.uid,
        flowId,
        title,
      ]);
    }

    res.json({ success: true, msg: "Flow was saved" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// get my flows
router.get("/get_mine", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM flow WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// try to make a request
router.post("/make_request_api", validateUser, async (req, res) => {
  try {
    const { url, body, headers, type } = req.body;

    if (!url || !type) {
      return res.json({ msg: "Url is required" });
    }

    const resp = await makeRequest({
      method: type,
      url,
      body,
      headers,
    });

    res.json(resp);
  } catch (err) {
    console.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// del a flow
router.post("/del_flow", validateUser, async (req, res) => {
  try {
    const { id, flowId } = req.body;

    await query(`DELETE FROM flow WHERE uid = ? AND id = ?`, [
      req.decode.uid,
      id,
    ]);

    const nodePath = `${__dirname}/../flow-json/nodes/${req.decode.uid}/${flowId}.json`;
    const edgePath = `${__dirname}/../flow-json/edges/${req.decode.uid}/${flowId}.json`;

    deleteFileIfExists(nodePath);
    deleteFileIfExists(edgePath);

    res.json({ success: true, msg: "Flow was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// get flow using flow id
router.post("/get_by_flow_id", validateUser, async (req, res) => {
  try {
    const { flowId } = req.body;

    if (!flowId) {
      return res.json({ success: false, msg: "Flow id missing" });
    }

    const nodePath = `${__dirname}/../flow-json/nodes/${req.decode.uid}/${flowId}.json`;
    const edgePath = `${__dirname}/../flow-json/edges/${req.decode.uid}/${flowId}.json`;

    const nodes = readJsonFromFile(nodePath);
    const edges = readJsonFromFile(edgePath);

    res.json({ nodes, edges, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// del a flow
router.post("/del_flow", validateUser, async (req, res) => {
  try {
    const { id, flowId } = req.body;

    await query(`DELETE FROM flow WHERE uid = ? AND id = ?`, [
      req.decode.uid,
      id,
    ]);

    const nodePath = `${__dirname}/../flow-json/nodes/${req.decode.uid}/${flowId}.json`;
    const edgePath = `${__dirname}/../flow-json/edges/${req.decode.uid}/${flowId}.json`;

    deleteFileIfExists(nodePath);
    deleteFileIfExists(edgePath);

    res.json({ success: true, msg: "Flow was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

module.exports = router;
