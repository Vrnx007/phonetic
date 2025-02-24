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
  replacePlaceholders,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const {
  gatherFunction,
  returnVars,
  getDevice,
  hangupCall,
  getNodeDataGather,
  getNextNode,
  processSay,
  processGather,
  processHangup,
  processCondition,
  processMakeRequest,
  captureData,
  moveOutgoingNext,
  processOpenAi,
  processSendMsg,
} = require("../functions/ivrFlow.js");
const { VoiceResponse } = require("twilio").twiml;
const twilio = require("twilio");
const { getConnectedUsers } = require("../socket");
const { OpenAI } = require("openai");

// get my devices with ivr
router.get("/get_my_ivr", validateUser, async (req, res) => {
  try {
    let data;
    data = await query(`SELECT * FROM device WHERE uid = ?`, [req.decode.uid]);

    data = data.map((x) => ({
      ...x,
      webhookUrl: `${process.env.BACKURI}/api/ivr/gather/${x.device_id}`,
      ivr: x.ivr ? JSON.parse(x.ivr) : { active: false, flow: {} },
      ivr_out: x.ivr_out ? JSON.parse(x.ivr_out) : { active: false, flow: {} },
      ivr_dial: x.ivr_dial
        ? JSON.parse(x.ivr_dial)
        : { active: false, flow: {} },
      webhookUrlOut: `${process.env.BACKURI}/api/ivr/out/gather/${x.device_id}`,
      webhookDialOut: `${process.env.BACKURI}/api/call/voice/${x.device_id}`,
    }));

    res.json({
      data,
      success: true,
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update flow in device
router.post("/update_flow_in_device", validateUser, async (req, res) => {
  try {
    const { deviceId, flowJson } = req.body;

    if (!deviceId) {
      return res.json({ msg: "Invalid request" });
    }

    if (!flowJson) {
      return res.json({ msg: "Please select a flow to update" });
    }

    const getDevice = await query(`SELECT * FROM device WHERE device_id = ?`, [
      deviceId,
    ]);

    if (getDevice.length < 1) {
      return res.json({ msg: "This device is not available" });
    }

    const device = getDevice[0];
    const deviceOut = device?.ivr_out
      ? JSON.parse(device?.ivr_out)
      : { active: false, flow: {} };

    const newDeviceOut = { ...deviceOut, active: false };

    const deviceDial = device?.ivr_dial
      ? JSON.parse(device?.ivr_dial)
      : { active: false, flow: {} };

    const newDeviceDial = { ...deviceDial, active: false };

    await query(
      `UPDATE device SET ivr = ?, ivr_out = ?, ivr_dial = ? WHERE device_id = ?`,
      [
        JSON.stringify(flowJson),
        JSON.stringify(newDeviceOut),
        JSON.stringify(newDeviceDial),

        deviceId,
      ]
    );

    res.json({ msg: "Flow was updated", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update flow in device out
router.post("/update_flow_in_device_out", validateUser, async (req, res) => {
  try {
    const { deviceId, flowJson } = req.body;

    if (!deviceId) {
      return res.json({ msg: "Invalid request" });
    }

    if (!flowJson) {
      return res.json({ msg: "Please select a flow to update" });
    }

    const getDevice = await query(`SELECT * FROM device WHERE device_id = ?`, [
      deviceId,
    ]);

    if (getDevice.length < 1) {
      return res.json({ msg: "This device is not available" });
    }

    const device = getDevice[0];
    const deviceIn = device?.ivr
      ? JSON.parse(device?.ivr)
      : { active: false, flow: {} };

    const newDeviceIn = { ...deviceIn, active: false };

    const deviceDial = device?.ivr_dial
      ? JSON.parse(device?.ivr_dial)
      : { active: false, flow: {} };

    const newDeviceDial = { ...deviceDial, active: false };

    await query(
      `UPDATE device SET ivr = ?, ivr_out = ?, ivr_dial = ? WHERE device_id = ?`,
      [
        JSON.stringify(newDeviceIn),
        JSON.stringify(flowJson),
        JSON.stringify(newDeviceDial),
        deviceId,
      ]
    );

    res.json({ msg: "Flow was updated", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update flow in device dial
router.post("/update_flow_in_device_dial", validateUser, async (req, res) => {
  try {
    const { deviceId, flowJson } = req.body;

    if (!deviceId) {
      return res.json({ msg: "Invalid request" });
    }

    if (!flowJson) {
      return res.json({ msg: "Please select a flow to update" });
    }

    const getDevice = await query(`SELECT * FROM device WHERE device_id = ?`, [
      deviceId,
    ]);

    if (getDevice.length < 1) {
      return res.json({ msg: "This device is not available" });
    }

    const device = getDevice[0];
    const deviceOut = device?.ivr_out
      ? JSON.parse(device?.ivr_out)
      : { active: false, flow: {} };

    const newDeviceOut = { ...deviceOut, active: false };

    const deviceIn = device?.ivr
      ? JSON.parse(device?.ivr)
      : { active: false, flow: {} };

    const newDeviceIn = { ...deviceIn, active: false };

    await query(
      `UPDATE device SET ivr = ?, ivr_out = ?, ivr_dial = ? WHERE device_id = ?`,
      [
        JSON.stringify(newDeviceIn),
        JSON.stringify(newDeviceOut),
        JSON.stringify(flowJson),
        deviceId,
      ]
    );

    res.json({ msg: "Flow was updated", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

router.post("/gather/:device", async (req, res) => {
  try {
    let generateMysqlId;
    let outgoingLog;
    const { device } = req.params;
    const { id, mysql, outgoing } = req.query;

    console.log(outgoing ? `Gathering for outgoing...` : `Gathering...`);

    if (outgoing) {
      const [log] = await query(
        `SELECT * FROM call_campaign_log WHERE id = ?`,
        [outgoing]
      );
      outgoingLog = log || null;
    } else {
      outgoingLog = null;
    }

    if (mysql) {
      generateMysqlId = mysql;
    } else {
      generateMysqlId = randomstring.generate(6);
    }

    const deviceObj = await getDevice({ deviceId: device, outgoingLog });

    if (!deviceObj.success) {
      const twiml = new VoiceResponse();
      hangupCall({ res, twiml, outgoingLog });
      if (outgoingLog) {
        await moveOutgoingNext({
          logId: outgoingLog?.id,
          hangup: true,
          msg: "DEVICE NOT FOUND",
        });
      }
      return;
    }

    const deviceData = deviceObj.data;

    const dialer = deviceData?.ivr_dial
      ? JSON.parse(deviceData?.ivr_dial)
      : null;

    if (dialer?.active) {
      const response = new VoiceResponse();
      const dial = response.dial({
        callerId: req.body.From,
        answerOnBridge: true,
      });

      dial.client(deviceData?.connected_id);
      res.set("Content-Type", "text/xml");
      res.send(response.toString());
      return;
    }

    const objVar = await returnVars({ id: generateMysqlId, req, outgoingLog });
    const getNode = await getNodeDataGather({
      deviceObj: deviceData,
      id,
      outgoingLog,
    });
    const node = getNode.data;

    if (!getNode.success) {
      const twiml = new VoiceResponse();
      hangupCall({ res, twiml });
      if (outgoingLog) {
        await moveOutgoingNext({
          logId: outgoingLog?.id,
          hangup: true,
          msg: "NODE IS NOT GETHER",
        });
      }
      return;
    } else {
      const msg = replacePlaceholders(node.data?.message, objVar);
      const twiml = new VoiceResponse();

      const gather = twiml.gather({
        action: outgoing
          ? `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${generateMysqlId}&outgoing=${outgoing}`
          : `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${generateMysqlId}`,
        numDigits: 10,
        method: "POST",
        record: "true",
      });

      gather.say(
        {
          language: node.data?.local?.language?.locale,
          voice: `Polly.${node.data?.local?.voice?.name}`,
          loop: 1,
        },
        msg
      );
      res.set("Content-Type", "text/xml");
      res.send(twiml.toString());
    }
  } catch (err) {
    if (req.query.outoing) {
      await moveOutgoingNext({
        logId: req.query.outoing,
        hangup: true,
        msg: "ISSUE FOUND IN GATHER",
      });
    }
    console.log(err);
    const twiml = new VoiceResponse();
    twiml.say("An error found in your gather");
    twiml.hangup();
    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  }
});

router.post("/reply", async (req, res) => {
  try {
    let outgoingLog;
    const { mysql, device, id, outgoing, ai } = req.query;
    const digitsFound = req.body?.Digits;

    if (outgoing) {
      const [log] = await query(
        `SELECT * FROM call_campaign_log WHERE id = ?`,
        [outgoing]
      );
      outgoingLog = log || null;
    } else {
      outgoingLog = null;
    }

    const deviceObj = await getDevice({ deviceId: device });

    if (!deviceObj.success) {
      const twiml = new VoiceResponse();
      hangupCall({ res, twiml });
      await moveOutgoingNext({
        logId: outgoingLog?.id,
        hangup: true,
        msg: "DEVICE NOT FOUND",
      });
      return;
    }
    const deviceData = deviceObj.data;

    const objVar = await returnVars({ id: mysql, req });

    const getNode = await getNextNode({
      deviceObj: deviceData,
      id,
      digitsFound,
      ai: ai || null,
    });
    const node = getNode.data;

    console.log({
      success: getNode?.success ? "getNode" : "No getNode",
      digitsFound,
    });

    if (!getNode.success) {
      const twiml = new VoiceResponse();
      await moveOutgoingNext({
        logId: outgoingLog?.id,
        hangup: true,
        msg: "NODE DATA INVALID",
      });
      hangupCall({ res, twiml });
      return;
    } else {
      switch (node.type) {
        case "SAY":
          processSay({
            req,
            res,
            node,
            objVar,
            device,
            deviceData,
            mysql,
            outgoingLog,
          });
          break;
        case "GATHER":
          processGather({
            req,
            res,
            node,
            objVar,
            device,
            deviceData,
            mysql,
            outgoingLog,
          });
          break;
        case "HANGUP":
          processHangup({
            req,
            res,
            node,
            objVar,
            device,
            deviceData,
            mysql,
            outgoingLog,
          });
          break;
        case "CONDITION":
          processCondition({
            req,
            res,
            node,
            objVar,
            device,
            deviceData,
            mysql,
            digitsFound,
            outgoingLog,
          });
          break;
        case "MAKE_REQUEST":
          processMakeRequest({
            req,
            res,
            node,
            objVar,
            device,
            deviceData,
            mysql,
            digitsFound,
            outgoingLog,
          });
          break;
        case "CAPTURE":
          captureData({
            req,
            res,
            node,
            objVar,
            device,
            deviceData,
            mysql,
            digitsFound,
            outgoingLog,
          });
          break;
        case "OPENAI":
          processOpenAi({
            req,
            res,
            node,
            objVar,
            device,
            deviceData,
            mysql,
            digitsFound,
            outgoingLog,
          });
          break;
        case "SEND_MSG":
          processSendMsg({
            req,
            res,
            node,
            objVar,
            device,
            deviceData,
            mysql,
            digitsFound,
            outgoingLog,
          });
          break;
        default:
          const twiml = new VoiceResponse();
          hangupCall({ res, twiml });
          await moveOutgoingNext({
            logId: outgoingLog?.id,
            hangup: true,
            msg: "UNKNOWN NODE FOUND",
          });
          break;
      }
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, msg: "something went wrong", err });
  }
});

function estimateSpeakingTime(text, wordsPerSecond = 2.5) {
  // Split the text into an array of words
  const wordCount = text.split(/\s+/).length;

  // Calculate the estimated time in seconds
  const timeInSeconds = wordCount / wordsPerSecond;

  // Return the estimated time (rounded to 2 decimal places)
  return parseFloat(timeInSeconds.toFixed(2));
}

async function returnReponse(question) {
  const openai = new OpenAI({
    apiKey: "sk---qQeatMHtYPFlWWfCXEXcsUi6q1kSVhXTwOKMA",
  });
  const chatGptResponseStream = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "आप हामिद की निजी सहायक हैं और आपका नाम नीना है। आप लोगों को हामिद के साथ मीटिंग शेड्यूल करने में मदद कर सकती हैं। हामिद सोमवार से बुधवार दोपहर 12 बजे से शाम 4 बजे तक उपलब्ध रहते हैं।",
      },
      {
        role: "user",
        content: question,
      },
    ],
    model: "gpt-3.5-turbo",
    max_tokens: 200,
  });
  const msg = chatGptResponseStream?.choices[0]?.message?.content;
  return msg;
}

router.get("/initiate-call", async (req, res) => {
  try {
    const client = twilio(
      "AC8f8d8160cff27026fcf115390af19f07",
      "30c2849dc0706d046f2de83fb10f73d9"
    );

    const call = await client.calls.create({
      to: "+19782481662",
      from: "+19786361859", // The Twilio number you're calling from
      url: `${process.env.BACKURI}/api/ivr/ring`, // A "ringing" message to play while the call is being connected
      method: "POST",
    });

    res.status(200).json({ success: true, callSid: call.sid });
  } catch (err) {
    console.error("Error initiating call:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/ring", async (req, res) => {
  const callStatus = req.body.CallStatus;

  console.log({ callStatus });

  const twiml = new VoiceResponse();

  const greetingsMgs = "नमस्ते क्या आप कुछ कहना चाहेंगे?";

  twiml.pause({ length: 5 });

  twiml.say(
    {
      language: "hi-IN",
      voice: `Polly.Aditi`,
      loop: 1,
    },
    greetingsMgs
  );

  // waiting twiml to say the msg
  twiml.pause({ length: estimateSpeakingTime(greetingsMgs) });

  console.log(`waiting for ${estimateSpeakingTime(greetingsMgs)}`);

  if (callStatus === "in-progress") {
    // Use <Gather> to capture speech input
    const gather = twiml.gather({
      input: "speech", // Capture speech input
      timeout: 1, // Detect pause quickly (1 second timeout for silence)
      action: `/api/ivr/process-speech/DfyerO`, // URL to send speech result to
      method: "POST",
      language: "hi-IN",
    });
  }

  if (callStatus === "completed") {
    console.log("Call was completed");
  }

  res.set("Content-Type", "text/xml");
  res.send(twiml.toString());
});

// Route to process the gathered speech input
router.post("/process-speech/:id", async (req, res) => {
  console.log("/process-speech/:id");

  const callStatus = req.body.CallStatus;
  const speechResult = req.body.SpeechResult;
  console.log("getting response of ai");

  const msg = await returnReponse(speechResult);

  // Log what the receiver said
  console.log(`Receiver said: ${speechResult}`);
  console.log(`Ai said:`, msg);

  const twiml = new VoiceResponse();

  twiml.say(
    {
      language: "hi-IN",
      voice: `Polly.Aditi`,
      loop: 1,
    },
    msg
  );

  // waiting twiml to say the msg
  twiml.pause({ length: estimateSpeakingTime(msg) });

  console.log(`waiting for ${estimateSpeakingTime(msg)}`);

  twiml.gather({
    input: "speech", // Capture speech input
    timeout: 2, // Detect pause quickly (1 second timeout for silence)
    action: `/api/ivr/process-speech/DfyerO`, // URL to send speech result to
    method: "POST",
    language: "hi-IN",
  });

  if (callStatus === "completed") {
    console.log("Call was completed at process");
  }

  res.set("Content-Type", "text/xml");
  res.send(twiml.toString());
});

module.exports = router;
