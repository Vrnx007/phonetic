const { query } = require("../database/dbpromise");
const { readJsonFromFile } = require("../functions/function");

const returnReqNotValid = async (req, res, next) => {
  try {
    const { device, id } = req.query;
    const { Digits, From, Called } = req.body;

    console.log("Came for reply");
    console.log({ device, id });

    if (!device || !id || !Digits || !From || !Called) {
      console.log("Required details not found for reply", {
        device,
        id,
        Digits,
        From,
        Called,
      });
      return res.status(404).json({
        success: false,
        msg: "Required details not found for reply",
      });
    }

    const getDevice = await query(`SELECT * FROM device WHERE device_id = ?`, [
      device,
    ]);

    if (getDevice.length < 1) {
      console.log(
        "Request came but device ID not found or invalid ID",
        req.query,
        req.body
      );
      return res
        .status(400)
        .json({ success: false, msg: "Device ID not found or invalid" });
    }

    const deviceDetails = getDevice[0];
    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      deviceDetails.uid,
    ]);

    if (getUser.length < 1 || !deviceDetails?.ivr) {
      console.log(`User with UID: ${deviceDetails.uid} not found`);
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    const userDetails = getUser[0];
    const flowId = JSON.parse(deviceDetails?.ivr)?.flow?.flow_id;
    const isIvrActive = JSON.parse(deviceDetails?.ivr)?.active;

    if (!isIvrActive) {
      console.log(`IVR found inactive, so returned`);
      return res
        .status(404)
        .json({ success: false, msg: "IVR found inactive, so returned" });
    }

    if (!flowId) {
      console.log(`Flow ID not found in device or it's not valid JSON`);
      return res.status(404).json({
        success: false,
        msg: "Flow ID not found in device or it's not valid JSON",
      });
    }

    const edgePath = `${__dirname}/../flow-json/edges/${userDetails.uid}/${flowId}.json`;
    const nodePath = `${__dirname}/../flow-json/nodes/${userDetails.uid}/${flowId}.json`;

    const nodes = readJsonFromFile(nodePath);
    const edges = readJsonFromFile(edgePath);

    if (nodes?.length < 1 || edges?.length < 1) {
      console.log(`Either node or edge has fewer than 1 item`);
      return res.status(404).json({
        success: false,
        msg: "Either node or edge has fewer than 1 item",
      });
    }

    req.middlewareData = {
      device: device,
      id: id || null,
      deviceDetails: deviceDetails,
      userDetails: userDetails,
      // flowFromDb: flowFromDb,
      nodes,
      edges,
    };

    next();
  } catch (err) {
    console.error("Error in returnReqNotValid:", err);
    res.status(500).json({
      success: false,
      msg: "Something went wrong",
      error: err.message,
    });
  }
};

const initialIvrWebhook = async (req, res, next) => {
  try {
    console.log("Incoming request", req.params);
    const { device } = req.params;
    const { id } = req.query;
    let inNodeData;
    let outNodeData;
    console.log({ device, id });

    const getDevice = await query(`SELECT * FROM device WHERE device_id = ?`, [
      device,
    ]);

    if (getDevice.length < 1) {
      console.log(
        "Request came but device ID not found or invalid ID",
        req.query,
        req.body
      );
      return res
        .status(400)
        .json({ success: false, msg: "Device ID not found or invalid" });
    }

    const deviceDetails = getDevice[0];
    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      deviceDetails.uid,
    ]);

    if (getUser.length < 1 || !deviceDetails?.ivr) {
      console.log(`User with UID: ${deviceDetails.uid} not found`);
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    const userDetails = getUser[0];
    const flowId = JSON.parse(deviceDetails?.ivr)?.flow?.flow_id;
    const isIvrActive = JSON.parse(deviceDetails?.ivr)?.active;

    if (!isIvrActive) {
      console.log(`IVR found inactive, so returned`);
      return res
        .status(404)
        .json({ success: false, msg: "IVR found inactive, so returned" });
    }

    if (!flowId) {
      console.log(`Flow ID not found in device or it's not valid JSON`);
      return res.status(404).json({
        success: false,
        msg: "Flow ID not found in device or it's not valid JSON",
      });
    }

    const edgePath = `${__dirname}/../flow-json/edges/${userDetails.uid}/${flowId}.json`;
    const nodePath = `${__dirname}/../flow-json/nodes/${userDetails.uid}/${flowId}.json`;

    const nodes = readJsonFromFile(nodePath);
    const edges = readJsonFromFile(edgePath);

    if (nodes?.length < 1 || edges?.length < 1) {
      console.log(`Either node or edge has fewer than 1 item`);
      return res.status(404).json({
        success: false,
        msg: "Either node or edge has fewer than 1 item",
      });
    }

    if (id) {
      const findNodeWithId = nodes.find((x) => x.id === id);
      if (!findNodeWithId) {
        console.log(`Node not found with ID:`, id);
        return res.status(404).json({
          success: false,
          msg: `Node not found with ID: ${id}`,
        });
      }

      const getEdge = edges.find((x) => x.source === id);
      if (!getEdge) {
        console.log(`Edge not found with ID:`, id);
        return res.status(404).json({
          success: false,
          msg: `Edge not found with ID: ${id}`,
        });
      }

      const getConnectedNode = nodes.find((x) => x.id === getEdge.target);

      inNodeData = findNodeWithId;
      outNodeData = getConnectedNode || {};
    } else {
      // Finding initial node
      const getInitialNode = nodes.find((x) => x.type === "INITIAL");
      if (!getInitialNode) {
        console.log(`No initial node found`);
        return res.status(404).json({
          success: false,
          msg: `No initial node found`,
        });
      }

      const getEdge = edges.find((x) => x.source === getInitialNode.id);
      if (!getEdge) {
        console.log(`Edge not found with ID:`, id);
        return res.status(404).json({
          success: false,
          msg: `Edge not found with ID: ${id}`,
        });
      }

      const getConnectedNode = nodes.find((x) => x.id === getEdge.target);
      inNodeData = getConnectedNode;
      outNodeData = getConnectedNode || {};
    }

    req.middlewareData = {
      device: device,
      id: id || null,
      deviceDetails: deviceDetails,
      userDetails: userDetails,
      inNodeData,
      outNodeData,
    };

    next();
  } catch (err) {
    console.error("Error in initialIvrWebhook:", err);
    res.status(500).json({
      success: false,
      msg: "Something went wrong",
      error: err.message,
    });
  }
};

const initialIvr = async (req, res, next) => {
  try {
    console.log("Incoming request", req.params);
    const { device } = req.params;
    const { id } = req.query;
    let inNodeData;
    let outNodeData;
    console.log({ device, id });

    const getDevice = await query(`SELECT * FROM device WHERE device_id = ?`, [
      device,
    ]);

    if (getDevice.length < 1) {
      console.log(
        "Request came but device ID not found or invalid ID",
        req.query,
        req.body
      );
      return res
        .status(400)
        .json({ success: false, msg: "Device ID not found or invalid" });
    }

    const deviceDetails = getDevice[0];
    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      deviceDetails.uid,
    ]);

    if (getUser.length < 1 || !deviceDetails?.ivr) {
      console.log(`User with UID: ${deviceDetails.uid} not found`);
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    const userDetails = getUser[0];
    const flowId = JSON.parse(deviceDetails?.ivr)?.flow?.flow_id;
    const isIvrActive = JSON.parse(deviceDetails?.ivr)?.active;

    if (!isIvrActive) {
      console.log(`IVR found inactive, so returned`);
      return res
        .status(404)
        .json({ success: false, msg: "IVR found inactive, so returned" });
    }

    if (!flowId) {
      console.log(`Flow ID not found in device or it's not valid JSON`);
      return res.status(404).json({
        success: false,
        msg: "Flow ID not found in device or it's not valid JSON",
      });
    }

    const edgePath = `${__dirname}/../flow-json/edges/${userDetails.uid}/${flowId}.json`;
    const nodePath = `${__dirname}/../flow-json/nodes/${userDetails.uid}/${flowId}.json`;

    const nodes = readJsonFromFile(nodePath);
    const edges = readJsonFromFile(edgePath);

    if (nodes?.length < 1 || edges?.length < 1) {
      console.log(`Either node or edge has fewer than 1 item`);
      return res.status(404).json({
        success: false,
        msg: "Either node or edge has fewer than 1 item",
      });
    }

    if (!id) {
      // getting initial node
      // Finding initial node
      const getInitialNode = nodes.find((x) => x.type === "INITIAL");
      if (!getInitialNode) {
        console.log(`No initial node found`);
        return res.status(404).json({
          success: false,
          msg: `No initial node found`,
        });
      }

      const getEdge = edges.find((x) => x.source === getInitialNode.id);
      if (!getEdge) {
        console.log(`Edge not found with ID:`, id);
        return res.status(404).json({
          success: false,
          msg: `Edge not found with ID: ${id}`,
        });
      }

      const getConnectedNode = nodes.find((x) => x.id === getEdge.target);

      req.node = getConnectedNode;
    } else {
      const getNodeById = nodes.find((x) => x.id === id);
      req.node = getNodeById;
    }

    next();
  } catch (err) {
    console.error("Error in initialIvrWebhook:", err);
    res.status(500).json({
      success: false,
      msg: "Something went wrong",
      error: err.message,
    });
  }
};

module.exports = { initialIvr, returnReqNotValid };
