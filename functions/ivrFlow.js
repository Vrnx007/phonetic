const { VoiceResponse } = require("twilio").twiml;
const { query } = require("../database/dbpromise");
const {
  readJsonFromFile,
  replacePlaceholders,
  makeRequestFlow,
  addPhonebookPrefix,
  ensureFileExists,
  returnOpenAiReply,
  pushToFileArray,
  sendSMSFlow,
} = require("./function");
const randomstring = require("randomstring");
const fs = require("fs").promises;

async function insertTextAfterEvery5Lines(filePath, text) {
  try {
    // Read the file contents
    const fileContent = await fs.readFile(filePath, "utf8");
    const lines = fileContent.split("\n");

    // Insert the text after every 5 lines
    const modifiedContent = lines.reduce((acc, line, index) => {
      acc.push(line);
      if ((index + 1) % 5 === 0) {
        acc.push(text);
      }
      return acc;
    }, []);

    // Join modified lines back to a single string and write to the file
    const result = modifiedContent.join("\n");
    await fs.writeFile(filePath, result, "utf8");
    console.log("Text inserted successfully.");
  } catch (error) {
    console.error("Error:", error);
  }
}

async function returnVars({ id = false, req, outgoingLog }) {
  const fallbackData = {
    recipient_number: req.body?.Caller || "",
    my_number: req.body?.To || req.body?.Called || "",
    digits: req.body?.Digits || req.query.digits,
  };

  if (!id) return fallbackData;

  const getData = await query(`SELECT * FROM temp_var WHERE unique_id = ?`, [
    id,
  ]);

  const outGoingVar = outgoingLog?.variables
    ? addPhonebookPrefix(JSON.parse(outgoingLog?.variables))
    : {};

  return getData.length > 0
    ? { ...JSON.parse(getData[0]?.data), ...fallbackData, ...outGoingVar }
    : fallbackData;
}

function hangupCall({ msg, twiml, res, outgoingLog }) {
  if (msg) {
    twiml.say(msg);
  }
  twiml.pause({ length: 2 });
  twiml.hangup();
  res.set("Content-Type", "text/xml").send(twiml.toString());
}

function getDevice({ deviceId, outgoingLog }) {
  return new Promise(async (resolve) => {
    try {
      const [device] = await query(`SELECT * FROM device WHERE device_id = ?`, [
        deviceId,
      ]);

      if (outgoingLog?.id) {
        device.ivr = device?.ivr_out;
      }

      resolve({ success: device ? true : false, data: device });
    } catch (err) {
      console.log(err);
      resolve({ success: false });
    }
  });
}

function getNodeDataGather({ deviceObj, id }) {
  return new Promise(async (resolve) => {
    try {
      const uid = deviceObj?.uid;
      const ivr = JSON.parse(deviceObj?.ivr);
      if (!ivr?.active) {
        console.log("IVR not seems to be active");
        return resolve({ success: false });
      }

      const edgePath = `${__dirname}/../flow-json/edges/${uid}/${ivr?.flow?.flow_id}.json`;
      const nodePath = `${__dirname}/../flow-json/nodes/${uid}/${ivr?.flow?.flow_id}.json`;

      const nodes = readJsonFromFile(nodePath);
      const edges = readJsonFromFile(edgePath);

      if (id) {
        const getNodeData = nodes.find((x) => x.id === id);
        return resolve({
          success: !!getNodeData?.id, // safer check
          data: getNodeData,
        });
      } else {
        const getGatherNode = nodes.find((x) => x.type === "INITIAL");
        const edgeData = edges.find((x) => x.sourceHandle === getGatherNode.id);
        const finalNode = nodes.find((x) => x.id === edgeData.target);

        if (finalNode?.id) {
          return resolve({ success: true, data: finalNode });
        } else {
          console.log("Connected node not found");
          return resolve({ success: false });
        }
      }
    } catch (err) {
      console.log(err);
      resolve({ success: false });
    }
  });
}

function getNextNode({ deviceObj, id, digitsFound, ai }) {
  return new Promise(async (resolve) => {
    try {
      const uid = deviceObj?.uid;
      const ivr = JSON.parse(deviceObj?.ivr);

      const edgePath = `${__dirname}/../flow-json/edges/${uid}/${ivr?.flow?.flow_id}.json`;
      const nodePath = `${__dirname}/../flow-json/nodes/${uid}/${ivr?.flow?.flow_id}.json`;

      const nodes = readJsonFromFile(nodePath);
      const edges = readJsonFromFile(edgePath);

      // return the same component if the request is ai in query
      if (ai) {
        const nodeData = nodes.find((x) => x.id === id);
        if (!nodeData) {
          console.log(`For ai node found`);
          return resolve({ success: false });
        } else {
          return resolve({ success: true, data: nodeData });
        }
      }

      if (digitsFound) {
        const getNodeOne = nodes.find((x) => x.id === id);
        const getDigitArr = getNodeOne?.data?.digit;
        const digitMatched = getDigitArr?.find(
          (x) => x?.digit?.toString() === digitsFound?.toString()
        );
        const otherMatched = getDigitArr?.find((x) => x?.digit === "OTHER");
        const getId = digitMatched?.id || otherMatched?.id;

        if (!getId) {
          console.log("getId not found in getNextNode()");
          return resolve({ success: false });
        } else {
          const edgeData = edges.find((x) => x?.sourceHandle === getId);
          const nodeData = nodes.find((x) => x?.id === edgeData?.target);

          if (!nodeData) {
            console.log("nodeData not found in getNextNode()");
            return resolve({ success: false });
          }

          return resolve({ success: true, data: nodeData });
        }
      } else {
        console.log(`finding from edge for id = `, id);
        const edgeData = edges.find((x) => x?.sourceHandle === id);
        const finalNode = nodes.find((x) => x?.id === edgeData?.target);

        if (finalNode?.id) {
          return resolve({ success: true, data: finalNode });
        } else {
          console.log("Connected node not found ");
          return resolve({ success: false });
        }
      }
    } catch (err) {
      console.log(err);
      resolve({ success: false });
    }
  });
}

function processSay({ req, res, node, objVar, device, mysql, outgoingLog }) {
  try {
    const msg = replacePlaceholders(node.data.message, objVar);
    const twiml = new VoiceResponse();

    twiml.say(
      {
        language: node.data?.local?.language?.locale,
        voice: `Polly.${node.data?.local?.voice?.name}`,
        loop: 1,
      },
      msg
    );

    const redirectUrl = outgoingLog?.id
      ? `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}&outgoing=${outgoingLog?.id}`
      : `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}`;
    twiml.redirect(redirectUrl);

    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Error in processSay:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
    moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
  }
}

async function processOpenaiFunctionRedirect({
  req,
  res,
  node,
  objVar,
  device,
  mysql,
  deviceData,
  digitsFound,
  outgoingLog,
}) {
  try {
  } catch (err) {
    console.error("Error in processOpenAiRing:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
  }
}

async function processOpenAiRing({
  req,
  res,
  node,
  objVar,
  device,
  mysql,
  deviceData,
  digitsFound,
  outgoingLog,
}) {
  try {
    const { ai } = req.query;
    const convoPath = `${__dirname}/../temp/${ai}.json`;
    const speechResult = req.body.SpeechResult;

    if (speechResult) {
      const newObjQue = {
        role: "user",
        content: speechResult,
      };
      pushToFileArray(convoPath, newObjQue);
    }

    const functionArr = node?.data?.taskArr;

    const replyByAi = await returnOpenAiReply({
      convoPath: convoPath,
      openaiApiKey: node?.data?.keys,
      openAiModel: node?.data?.aiMode,
      trainText: node?.data?.trainText,
      historyLength: node?.data?.history,
      functionArr: functionArr,
      question: speechResult,
      allowTask: node?.data?.allowTask,
    });

    const twiml = new VoiceResponse();

    if (!replyByAi?.success) {
      console.error("Error in processOpenAiRing:", replyByAi);
      hangupCall({
        msg: replyByAi?.err || "Could not fetech reply from the openai ",
        twiml,
        res,
      });
    } else if (replyByAi?.function) {
      console.log("FUNCTION FOUND");

      const redirectUrl = outgoingLog?.id
        ? `/api/ivr/reply?device=${device}&id=${replyByAi?.function}&mysql=${mysql}&outgoing=${outgoingLog?.id}`
        : `/api/ivr/reply?device=${device}&id=${replyByAi?.function}&mysql=${mysql}`;
      twiml.redirect(redirectUrl);
    } else {
      const pauseSec = estimateSpeakingTime(
        replyByAi?.msg,
        parseInt(node?.data?.words_per_sec || 3)
      );

      twiml.say(
        {
          language: node.data?.local?.language?.locale,
          voice: `Polly.${node.data?.local?.voice?.name}`,
          loop: 1,
        },
        replyByAi?.msg
      );

      twiml.pause({ length: pauseSec });

      console.log(`Waiting for ${pauseSec} sec`);

      const newObj = {
        role: "assistant",
        content: replyByAi?.msg,
      };

      const redirectUrl = outgoingLog?.id
        ? `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}&outgoing=${outgoingLog?.id}&ai=${ai}&ringback=true`
        : `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}&ai=${ai}&ringback=true`;

      pushToFileArray(convoPath, newObj);
      console.log({
        aiQiestion: speechResult,
        aiAnswer: replyByAi?.msg,
      });

      twiml.redirect(redirectUrl);
    }

    console.log({ replyByAi: JSON.stringify(replyByAi) });
    // const filePath = `${__dirname}/../z.txt`;
    // const text = JSON.stringify(replyByAi);
    // insertTextAfterEvery5Lines(filePath, text);

    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Error in processOpenAiRing:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
  }
}

async function processOpenAi({
  req,
  res,
  node,
  objVar,
  device,
  mysql,
  deviceData,
  digitsFound,
  outgoingLog,
}) {
  try {
    console.log("processOpenAi");

    const { ring, ai, ringback } = req.query;
    let convoFile;

    if (ai) {
      convoFile = ai;
    } else {
      // creating temp path
      const randomSt = randomstring.generate(5);
      const pathToreated = `${__dirname}/../temp/${randomSt}.json`;

      const msg = replacePlaceholders(node.data.openingSay, objVar);

      const arrConvo = [
        {
          role: "assistant",
          content: msg,
        },
      ];

      ensureFileExists(pathToreated, arrConvo);

      convoFile = randomSt;
    }

    console.log({ convoFile });

    if (ring) {
      processOpenAiRing({
        req,
        res,
        node,
        objVar,
        device,
        mysql,
        deviceData,
        digitsFound,
        outgoingLog,
      });
    } else {
      const msg = replacePlaceholders(node.data.openingSay, objVar);
      const pauseSec = estimateSpeakingTime(
        msg,
        parseInt(node?.data?.words_per_sec || 3)
      );
      const twiml = new VoiceResponse();

      if (!ringback) {
        console.log({
          language: node.data?.local?.language?.locale,
          voice: `Polly.${node.data?.local?.language?.language}`,
          loop: 1,
          msg: msg,
        });

        twiml.say(
          {
            language: node.data?.local?.language?.locale,
            voice: `Polly.${node.data?.local?.voice?.name}`,
            loop: 1,
          },
          msg
        );

        twiml.pause({ length: pauseSec });
        console.log(`Waiting for ${pauseSec} sec`);
      }

      twiml.play(
        process.env.BEEPSOURCE || "https://www.soundjay.com/buttons/beep-02.wav"
      );
      twiml.pause({ length: 1 });
      console.log(`Twiml paused for ${pauseSec} sec`);

      const redirectUrl = outgoingLog?.id
        ? `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}&outgoing=${outgoingLog?.id}&ai=${convoFile}&ring=true`
        : `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}&ai=${convoFile}&ring=true`;

      twiml.gather({
        input: "speech", // Capture speech input
        timeout: 2, // Detect pause quickly (1 second timeout for silence)
        action: redirectUrl, // URL to send speech result to
        method: "POST",
        language: node.data?.local?.language?.locale,
      });

      res.set("Content-Type", "text/xml");
      res.send(twiml.toString());
    }
  } catch (err) {
    console.error("Error in processOpenAi:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
  }
}

function processGather({ req, res, node, objVar, device, mysql, outgoingLog }) {
  try {
    console.log("gather found so redirecting...");
    const redirectUrl = outgoingLog?.id
      ? `/api/ivr/gather/${device}?id=${node.id}&mysql=${mysql}&outgoing=${outgoingLog?.id}`
      : `/api/ivr/gather/${device}?id=${node.id}&mysql=${mysql}`;

    const twiml = new VoiceResponse();
    twiml.redirect(redirectUrl);

    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Error in processGather:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
  }
}

function processHangup({ req, res, node, objVar, device, mysql, outgoingLog }) {
  try {
    console.log("COMING TO HANGUP");
    const twiml = new VoiceResponse();

    if (node.data.message) {
      const msg = replacePlaceholders(node.data.message, objVar);

      twiml.say(
        {
          language: node.data?.local?.language?.locale,
          voice: `Polly.${node.data?.local?.voice?.name}`,
          loop: 1,
        },
        msg
      );
    }

    twiml.pause({ length: 2 });
    twiml.hangup();

    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());

    moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "COMPLETED",
    });
  } catch (err) {
    console.error("Error in processGather:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
  }
}

async function processMakeRequest({
  req,
  res,
  node,
  objVar,
  device,
  mysql,
  deviceData,
  digitsFound,
  outgoingLog,
}) {
  try {
    const url = replacePlaceholders(node.data?.url, objVar);
    const method = node?.data?.type;
    const body = node?.data?.body;
    const headers = node?.data?.headers;

    const resp = await makeRequestFlow({
      url,
      method,
      body,
      headers,
    });

    if (resp.data && resp.success) {
      // const getting obj from mysql
      const getObj = await query(`SELECT * FROM temp_var WHERE unique_id = ?`, [
        mysql || "na",
      ]);
      if (getObj?.length > 0) {
        const newObj = getObj[0]?.data
          ? { ...JSON.parse(getObj[0]?.data), ...resp.data }
          : resp.data;

        await query(`UPDATE temp_var SET data = ? WHERE ,[unique_id = ?`, [
          JSON.stringify(newObj),
          mysql || "na",
        ]);
      } else {
        if (mysql) {
          const newObj = resp.data;
          await query(`INSERT INTO temp_var (unique_id, data) VALUES (?,?)`, [
            mysql,
            JSON.stringify(newObj),
          ]);
        }
      }
    }

    const twiml = new VoiceResponse();

    const redirectUrl = outgoingLog?.id
      ? `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}&outgoing=${outgoingLog?.id}`
      : `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}`;
    twiml.redirect(redirectUrl);

    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Error in processMakeRequest:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    await moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
  }
}

async function processSendMsg({
  req,
  res,
  node,
  objVar,
  device,
  mysql,
  deviceData,
  digitsFound,
  outgoingLog,
}) {
  try {
    const msg = replacePlaceholders(node?.data?.message, objVar);

    await sendSMSFlow({
      device: node?.data?.device,
      body: msg,
      mobileTo: objVar?.recipient_number,
    });

    const twiml = new VoiceResponse();

    const redirectUrl = outgoingLog?.id
      ? `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}&outgoing=${outgoingLog?.id}`
      : `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}`;
    twiml.redirect(redirectUrl);

    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Error in processSendMsg:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    await moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
  }
}

async function captureData({
  req,
  res,
  node,
  objVar,
  device,
  mysql,
  deviceData,
  digitsFound,
  outgoingLog,
}) {
  try {
    const msg = replacePlaceholders(node.data.message, objVar);

    await query(
      `INSERT INTO flow_response (uid, text, caller_number, my_number, digit, broadcast_id) VALUES (?,?,?,?,?,?)`,
      [
        deviceData?.uid,
        msg,
        objVar?.recipient_number || "NA",
        objVar?.my_number || "NA",
        objVar?.digits || "NA",
        outgoingLog?.broadcast_id || "NA",
      ]
    );

    const twiml = new VoiceResponse();

    const redirectUrl = outgoingLog?.id
      ? `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}&outgoing=${outgoingLog?.id}`
      : `/api/ivr/reply?device=${device}&id=${node.id}&mysql=${mysql}`;
    twiml.redirect(redirectUrl);

    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Error in captureData:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    await moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
  }
}

function estimateSpeakingTime(text, wordsPerSecond = 4) {
  // Split the text into an array of words
  const wordCount = text.split(/\s+/).length;

  // Calculate the estimated time in seconds
  const timeInSeconds = wordCount / wordsPerSecond;

  // Return the estimated time (rounded to 2 decimal places)
  return parseFloat(timeInSeconds.toFixed(2));
}

async function processCondition({
  req,
  res,
  node,
  objVar,
  device,
  mysql,
  deviceData,
  digitsFound,
  outgoingLog,
}) {
  try {
    const equalDigit = node?.data?.ifEqual;
    const notEqual = node?.data?.ifNotEqual;
    const digitPressed = digitsFound;

    console.log({ equalDigit, notEqual, digitPressed });

    if (equalDigit?.digit?.toString() === digitPressed?.toString()) {
      const twiml = new VoiceResponse();
      const redirectUrl = outgoingLog?.id
        ? `/api/ivr/reply?device=${device}&id=${equalDigit.id}&mysql=${mysql}&digits=${digitPressed}&outgoing=${outgoingLog?.id}`
        : `/api/ivr/reply?device=${device}&id=${equalDigit.id}&mysql=${mysql}&digits=${digitPressed}`;
      twiml.redirect(redirectUrl);

      res.set("Content-Type", "text/xml");
      res.send(twiml.toString());
    } else {
      const twiml = new VoiceResponse();
      const redirectUrl = outgoingLog?.id
        ? `/api/ivr/reply?device=${device}&id=${notEqual.id}&mysql=${mysql}&digits=${digitPressed}&outgoing=${outgoingLog?.id}`
        : `/api/ivr/reply?device=${device}&id=${notEqual.id}&mysql=${mysql}&digits=${digitPressed}`;
      twiml.redirect(redirectUrl);

      res.set("Content-Type", "text/xml");
      res.send(twiml.toString());
    }
  } catch (err) {
    console.error("Error in processCondition:", err); // Log the error object to get more insights
    const twiml = new VoiceResponse();
    await moveOutgoingNext({
      logId: outgoingLog?.id,
      hangup: true,
      msg: "An error occurred while processing the request, Goodbye!",
    });
    hangupCall({
      msg: "An error occurred while processing the request, Goodbye!",
      twiml,
      res,
    });
  }
}

async function moveOutgoingNext({ logId, hangup = false, msg }) {
  if (!logId) return;
  console.log(`Came to moveOutgoingNext`);
  console.log({ logId, hangup, msg });
  const [getNext] = await query(
    `SELECT * FROM call_campaign_log WHERE id = ?`,
    [logId]
  );

  if (hangup) {
    console.log(`log ${logId} set to completed`);
    await query(`UPDATE call_campaign_log SET status = ? WHERE id = ?`, [
      msg,
      logId,
    ]);
  }

  if (getNext) {
    const [broadLogNext] = await query(
      `SELECT * FROM call_campaign_log WHERE broadcast_id = ? AND status = ? LIMIT 1`,
      [getNext.broadcast_id, "INITIATED"]
    );

    if (broadLogNext) {
      await query(`UPDATE call_campaign_log SET status = ? WHERE id = ?`, [
        "CALLING",
        broadLogNext?.id,
      ]);
    }
  }
}

module.exports = {
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
};
