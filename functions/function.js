const { query } = require("../database/dbpromise");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const AccessToken = twilio.jwt.AccessToken;
const { ChatGrant, VideoGrant, VoiceGrant } = AccessToken;
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { OpenAI } = require("openai");
const nodemailer = require("nodemailer");
const unzipper = require("unzipper");

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function folderExists(folderPath) {
  try {
    fs.accessSync(folderPath, fs.constants.F_OK);
    return true;
  } catch (error) {
    // Folder does not exist or inaccessible
    return false;
  }
}

async function getServiceKeys({ uid }) {
  const openAi = await query(
    `SELECT * FROM ai_key WHERE uid = ? AND key_type = ?`,
    [uid, "openai"]
  );

  const geminiAi = await query(
    `SELECT * FROM ai_key WHERE uid = ? AND key_type = ?`,
    [uid, "gemini"]
  );

  const googleCloud = await query(
    `SELECT * FROM ai_key WHERE uid = ? AND key_type = ?`,
    [uid, "google-cloud"]
  );

  if (openAi.length > 1 || geminiAi.length > 1 || googleCloud.length > 1) {
    await query(`DELETE FROM ai_key WHERE uid = ?`, [uid]);
    return {
      openai: "",
      geminiAi: "",
      googleCloud: "",
    };
  } else {
    return {
      openai: openAi?.length > 0 ? openAi[0]?.data : "",
      geminiAi: geminiAi?.length > 0 ? geminiAi[0]?.data : "",
      googleCloud: googleCloud?.length > 0 ? googleCloud[0]?.data : "",
    };
  }
}

function processWebSocketMessage(message) {
  try {
    // Try to parse the message as JSON
    const parsedMessage = JSON.parse(message);

    // Check if the parsed message is an object
    if (typeof parsedMessage === "object" && parsedMessage !== null) {
      return {
        success: true,
        message: parsedMessage,
      };
    } else {
      // Parsed message is not an object
      return {
        success: false,
        message: "Message is not a valid object",
      };
    }
  } catch (error) {
    // Message is not valid JSON
    return {
      success: false,
      message: message,
    };
  }
}

function verifyJwt(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, process.env.JWTKEY, (err, decoded) => {
      if (err) {
        resolve({
          success: false,
          data: {},
          message: "Invalid token",
        });
      } else {
        resolve({
          success: true,
          data: decoded,
        });
      }
    });
  });
}

function extractHostname(url) {
  try {
    // If no protocol is provided, assume http
    if (!/^https?:\/\//i.test(url)) {
      url = `http://${url}`;
    }

    // Create a new URL object
    const parsedUrl = new URL(url);

    // Return the hostname (without port or protocol)
    return parsedUrl.hostname;
  } catch (error) {
    // Handle invalid URLs
    console.error("Invalid URL provided:", error.message);
    return null;
  }
}

function normalizeMobileNumber(mobileNumber) {
  if (!mobileNumber) return null;

  // Remove spaces, plus signs, and non-numeric characters
  const cleanedNumber = mobileNumber.replace(/[^\d]/g, "");

  // If the number starts with '00' (international format), convert it to '+'
  if (mobileNumber.startsWith("00")) {
    return `+${cleanedNumber.slice(2)}`;
  }

  return cleanedNumber;
}

function objectToCustomString(obj) {
  try {
    // Convert object to JSON string
    const jsonString = JSON.stringify(obj);
    // Encode JSON string in Base64
    return Buffer.from(jsonString).toString("base64");
  } catch (error) {
    console.error(
      `Error converting object to encoded string: ${error.message}`
    );
    return null;
  }
}

function customStringToObject(str) {
  try {
    // Decode the Base64 string
    const jsonString = Buffer.from(str, "base64").toString();
    // Parse JSON string to object
    return JSON.parse(jsonString);
  } catch (error) {
    console.error(
      `Error converting encoded string to object: ${error.message}`
    );
    return null;
  }
}

const generateToken = (config, identity) => {
  return new AccessToken(config.accountSid, config.apiKey, config.apiSecret, {
    identity: identity || "default",
  });
};

const voiceToken = ({ identity, config }) => {
  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: config.outgoingApplicationSid,
    incomingAllow: config.incomingAllow || true,
  });

  // Generate the base token
  const token = generateToken(config, identity);

  // Add the Voice Grant to the token
  token.addGrant(voiceGrant);

  // Set the custom identity for the user
  token.identity = identity;

  // Return the token
  return token.toJwt();
};

function areMobileNumbersFilled(array) {
  for (const item of array) {
    if (!item.mobile) {
      return false;
    }
  }

  return true;
}

function parseCSVFile(fileData) {
  return new Promise((resolve, reject) => {
    const results = [];

    // Check if file data is provided
    if (!fileData) {
      resolve(null);
      return;
    }

    const stream = require("stream");
    const bufferStream = new stream.PassThrough();

    // Convert file data (Buffer) to a readable stream
    bufferStream.end(fileData);

    // Use csv-parser to parse the CSV data
    bufferStream
      .pipe(csv())
      .on("data", (data) => {
        // Push each row of data to the results array
        results.push(data);
      })
      .on("end", () => {
        // Resolve the promise with the parsed CSV data
        resolve(results);
      })
      .on("error", (error) => {
        // Reject the promise if there is an error
        resolve(null);
      });
  });
}

function sendTwilioSms({ accountSid, authToken, body, from, to }) {
  return new Promise(async (resolve) => {
    try {
      const client = twilio(accountSid, authToken);

      const resp = await client.messages.create({
        body,
        from,
        to,
      });

      resolve({ success: true, msg: "Sms was sent", geo: {} });
    } catch (err) {
      resolve({ msg: err?.toString(), success: false });
    }
  });
}

function writeJsonToFile(filepath, jsonData, callback) {
  return new Promise((resolve, reject) => {
    // Ensure directory structure exists
    const directory = path.dirname(filepath);
    fs.mkdir(directory, { recursive: true }, function (err) {
      if (err) {
        if (callback) {
          callback(err);
        }
        reject(err);
        return;
      }

      // Convert JSON data to string
      const jsonString = JSON.stringify(jsonData, null, 2); // 2 spaces indentation for readability

      // Write JSON data to file, with 'w' flag to overwrite existing file
      fs.writeFile(filepath, jsonString, { flag: "w" }, function (err) {
        if (err) {
          if (callback) {
            callback(err);
          }
          reject(err);
          return;
        }
        const message = `JSON data has been written to '${filepath}'.`;
        if (callback) {
          callback(null, message);
        }
        resolve(message);
      });
    });
  });
}

function deleteFileIfExists(filePath) {
  // Check if the file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // File does not exist, do nothing
      console.error(`File ${filePath} does not exist.`);
      return;
    }

    // File exists, delete it
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error(`Error deleting file ${filePath}:`, err);
        return;
      }
      console.log(`File ${filePath} has been deleted.`);
    });
  });
}

function readJsonFromFile(filePath) {
  try {
    // Read the file synchronously
    const jsonData = fs.readFileSync(filePath, "utf8");
    // Parse JSON data
    const parsedData = JSON.parse(jsonData);
    // If parsed data is an array, return it, otherwise return an empty array
    return Array.isArray(parsedData) ? parsedData : [];
  } catch (err) {
    // If any error occurs (e.g., file not found or invalid JSON), return an empty array
    console.error(`Error reading JSON file ${filePath}:`, err);
    return [];
  }
}

function replacePlaceholders(template, data) {
  return template.replace(/{{{([^}]+)}}}/g, (match, key) => {
    key = key.trim();

    // Handle `JSON.stringify()` calls
    if (key.startsWith("JSON.stringify(") && key.endsWith(")")) {
      const innerKey = key.slice(15, -1).trim(); // Extract what's inside the parentheses
      const keys = innerKey.split(/[\.\[\]]/).filter(Boolean);

      let value = data;
      for (const k of keys) {
        if (
          value &&
          (Array.isArray(value)
            ? value[parseInt(k, 10)] !== undefined
            : Object.prototype.hasOwnProperty.call(value, k))
        ) {
          value = Array.isArray(value) ? value[parseInt(k, 10)] : value[k];
        } else {
          return "NA";
        }
      }

      return JSON.stringify(value);
    }

    // Split the key to handle both array and object properties
    const keys = key.split(/[\.\[\]]/).filter(Boolean);

    let value = data;
    for (const k of keys) {
      if (
        value &&
        (Array.isArray(value)
          ? value[parseInt(k, 10)] !== undefined
          : Object.prototype.hasOwnProperty.call(value, k))
      ) {
        value = Array.isArray(value) ? value[parseInt(k, 10)] : value[k];
      } else {
        return "NA"; // Return 'NA' if key or index is not found
      }
    }

    return value !== undefined ? value : "NA"; // Return 'NA' if value is undefined
  });
}

async function makeRequest({ method, url, body = null, headers = [] }) {
  try {
    // Create an AbortController to handle the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 seconds

    // Convert headers array to an object
    const headersObject = headers.reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {});

    // Convert body array to an object if it's not GET or DELETE
    const requestBody =
      method === "GET" || method === "DELETE"
        ? undefined
        : JSON.stringify(
            body.reduce((acc, { key, value }) => {
              acc[key] = value;
              return acc;
            }, {})
          );

    // Set up the request configuration
    const config = {
      method,
      headers: headersObject,
      body: requestBody,
      signal: controller.signal,
    };

    console.log({
      config,
    });

    // Perform the request
    const response = await fetch(url, config);

    // Clear the timeout
    clearTimeout(timeoutId);

    // Check if the response status is OK
    if (!response.ok) {
      return { success: false, msg: `HTTP error ${response.status}` };
    }

    // Parse the response
    const data = await response.json();

    // Validate the response
    if (typeof data === "object" || Array.isArray(data)) {
      return { success: true, data };
    } else {
      return { success: false, msg: "Invalid response format" };
    }
  } catch (error) {
    // Handle errors (e.g., timeout, network issues)
    return { success: false, msg: error.message };
  }
}

async function makeRequestFlow({ method, url, body = null, headers = [] }) {
  try {
    // Create an AbortController to handle the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 20 seconds

    // Convert headers array to an object
    const headersObject = headers.reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {});

    // Convert body array to an object if it's not GET or DELETE
    const requestBody =
      method === "GET" || method === "DELETE"
        ? undefined
        : JSON.stringify(
            body.reduce((acc, { key, value }) => {
              acc[key] = value;
              return acc;
            }, {})
          );

    // Set up the request configuration
    const config = {
      method,
      headers: headersObject,
      body: requestBody,
      signal: controller.signal,
    };

    console.log({
      config,
    });

    // Perform the request
    const response = await fetch(url, config);

    // Clear the timeout
    clearTimeout(timeoutId);

    // Check if the response status is OK
    if (!response.ok) {
      return { success: false, msg: `HTTP error ${response.status}` };
    }

    // Parse the response
    const data = await response.json();

    // Validate the response
    if (typeof data === "object" || Array.isArray(data)) {
      return { success: true, data };
    } else {
      return { success: false, msg: "Invalid response format" };
    }
  } catch (error) {
    // Handle errors (e.g., timeout, network issues)
    return { success: false, msg: error.message };
  }
}

function returnNodeAfterAddingVars({ node, obj = {} }) {
  if (node.type === "SAY") {
    const newNode = {
      ...node,
      data: {
        ...node.data,
        message: replacePlaceholders(node.data?.message, obj),
      },
    };
    return newNode;
  } else if (node.type === "MAKE_REQUEST") {
    const newNode = {
      ...node,
      data: {
        ...node.data,
        url: replacePlaceholders(node.data?.url, obj),
      },
    };
    return newNode;
  } else if (node.type === "CONDITION") {
    const newNode = {
      ...node,
      data: {
        ...node.data,
        ifEqual: {
          ...node.data.ifEqual,
          digit: replacePlaceholders(node.data?.ifEqual.digit, obj),
        },
        ifNotEqual: {
          ...node.data.ifNotEqual,
          digit: replacePlaceholders(node.data?.ifNotEqual.digit, obj),
        },
      },
    };
    return newNode;
  } else if (node.type === "GATHER") {
    const newNode = {
      ...node,
      data: {
        ...node.data,
        message: replacePlaceholders(node.data?.message, obj),
      },
    };
    return newNode;
  } else if (node.type === "MAKE_REQUEST") {
    const newNode = {
      ...node,
      data: {
        ...node.data,
        url: replacePlaceholders(node.data?.url, obj),
      },
    };
    return newNode;
  } else {
    return node;
  }
}

function addPhonebookPrefix(obj) {
  // Check if the passed value is an object and not null
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return {}; // Return empty object if invalid value is passed
  }

  // Create a new object with the modified keys
  const prefixedObj = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      // Add 'phonebook_keyName_' before each key
      prefixedObj[`phonebook_${key}`] = obj[key];
    }
  }

  return prefixedObj;
}

function ensureFileExists(filePath, someArr = []) {
  // Ensure the directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true }); // Create directories if they don't exist
  }

  // Check if the file exists
  if (!fs.existsSync(filePath)) {
    // File does not exist, so create it with either the passed array or an empty array
    fs.writeFileSync(filePath, JSON.stringify(someArr), "utf8");
    console.log(`File created at: ${filePath} with data:`, someArr);
  } else {
    // File already exists, no action needed
    console.log(`File already exists at: ${filePath}`);
  }
}

function readJSONFile(filePath, length) {
  try {
    console.log("HEY");
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      console.error("File not found:", filePath);
      return []; // Return empty array if file does not exist
    }

    // Read the file content
    let fileContent = fs.readFileSync(filePath, "utf8");

    // }\n]  }\n]

    if (fileContent?.endsWith("}\n]  }\n]")) {
      console.log("FOUND ENDS");
      console.log("Invalid JSON found, making it correct");
      fileContent = fileContent.replace("}\n]  }\n]", "\n}\n]");
      console.log("Correction done!");

      // Write the corrected JSON back to the file
      fs.writeFileSync(filePath, fileContent, "utf8");
      console.log("Corrected JSON has been written to the file");
    }

    // Remove invalid trailing characters if they exist
    if (fileContent?.endsWith("}\n]\n}\n]")) {
      console.log("FOUND ENDS");
      console.log("Invalid JSON found, making it correct");
      fileContent = fileContent.replace("}\n]\n}\n]", "\n}\n]");
      console.log("Correction done!");

      // Write the corrected JSON back to the file
      fs.writeFileSync(filePath, fileContent, "utf8");
      console.log("Corrected JSON has been written to the file");
    }

    // Try to parse the JSON
    let jsonArray;
    try {
      jsonArray = JSON.parse(fileContent);
    } catch (error) {
      console.error("Initial JSON parse error:", error.message);
      return []; // Return empty array if JSON is not valid
    }

    // Check if the parsed content is an array
    if (!Array.isArray(jsonArray)) {
      console.error("Invalid JSON format: not an array");
      return []; // Return empty array if JSON is not an array
    }

    // If length is provided, return only specified number of latest objects
    if (typeof length === "number" && length > 0) {
      return jsonArray.slice(-length);
    }

    return jsonArray; // Return all objects if length is not provided or invalid
  } catch (error) {
    console.error("Error reading JSON file:", error);
    return []; // Return empty array if there's an error
  }
}

function returnOpenaiArr({
  dirPath,
  lengthNum,
  trainData,
  functionArr,
  allowTask,
  nodes,
}) {
  const data = readJSONFile(dirPath, lengthNum || 2);

  const filterOnlyText = data?.filter((x) => x.type == "text");

  const filterArr = filterOnlyText.map((i) => {
    return {
      role: i?.route === "INCOMING" ? "user" : "assistant",
      content: i?.type === "text" ? i?.msgContext?.text?.body ?? "" : "",
    };
  });

  const trainObj = {
    role: "system",
    content: trainData || "You are helpful assistant",
  };

  const actualMessage = [trainObj, ...filterArr];

  const correctFunctionArr = allowTask
    ? functionArr.map((x) => {
        return {
          name: findTaskById(nodes, x.id).id,
          description: findTaskById(nodes, x.id).text,
        };
      })
    : null;

  return { msgArr: actualMessage, funArr: correctFunctionArr };
}

function returnOpenAiReply({
  convoPath,
  historyLength = 1,
  trainText,
  openaiApiKey,
  openAiModel,
  functionArr,
  question,
  allowTask,
}) {
  console.log({ historyLength });
  return new Promise(async (resolve) => {
    try {
      const getConvoArr = readJSONFile(convoPath, historyLength);

      const trainObj = {
        role: "system",
        content: trainText,
      };

      const finalArr = [trainObj, ...getConvoArr];

      // console.log({ finalArr: JSON.stringify(finalArr) });

      // console.log({ finalArr: finalArr });

      const openai = new OpenAI({
        apiKey: openaiApiKey,
      });

      const correctFunctionArr = allowTask
        ? functionArr.map((x) => {
            return {
              name: x.id,
              description: x.text,
            };
          })
        : null;

      const responseData = await openai.chat.completions.create({
        model: openAiModel,
        messages: finalArr,
        ...(functionArr?.length > 0 &&
          allowTask && {
            functions: correctFunctionArr,
            function_call: "auto",
          }),
      });

      if (responseData?.error || responseData?.choices?.length < 1) {
        resolve({
          success: false,
          err: responseData?.error?.message || "Error found in OpenAI keys",
        });
      } else {
        resolve({
          success: true,
          msg: responseData.choices[0].message?.content,
          function:
            responseData.choices[0].message?.function_call?.name || false,
        });
      }
    } catch (err) {
      console.log(err);
      resolve({ success: false, err: err?.toString() });
    }
  });
}

function pushToFileArray(filePath, obj) {
  try {
    // Check if file exists
    let data = [];

    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf8");
      data = JSON.parse(fileContent); // Parse existing data

      // Ensure the file content is an array
      if (!Array.isArray(data)) {
        throw new Error("File content is not an array");
      }
    }

    // Push the new object to the array
    data.push(obj);

    // Write updated array back to the file
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    console.log("Object pushed to file successfully.");
  } catch (err) {
    // Ignore any errors and do nothing
    console.error("Error occurred:", err.message);
  }
}

async function sendSMSFlow({ device, mobileTo, body }) {
  try {
    const resp = await sendTwilioSms({
      accountSid: device?.sid,
      authToken: device?.token,
      body,
      from: `+${normalizeMobileNumber(device?.number)}`,
      to: `+${normalizeMobileNumber(mobileTo)}`,
    });

    if (resp.success) {
      await query(
        `INSERT INTO messages (device_id, uid, body, msg_from, msg_to, route, recipient, twilio_number) VALUES (?,?,?,?,?,?,?,?)`,
        [
          device?.device_id,
          device?.uid,
          body,
          `+${normalizeMobileNumber(device?.number)}`,
          `+${normalizeMobileNumber(mobileTo)}`,
          "OUTGOING",
          `+${normalizeMobileNumber(mobileTo)}`,
          `+${normalizeMobileNumber(device?.number)}`,
        ]
      );
    }
  } catch (err) {
    console.log(`Wrror found in pushToFileArray() ${err}`);
  }
}

function getFileExtension(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex !== -1 && dotIndex !== 0) {
    const extension = fileName.substring(dotIndex + 1);
    return extension.toLowerCase();
  }
  return "";
}

function sendEmail(host, port, email, pass, html, subject, from, to) {
  return new Promise(async (resolve) => {
    try {
      let transporter = nodemailer.createTransport({
        host: host,
        port: port,
        secure: port === "465" ? true : false, // true for 465, false for other ports
        auth: {
          user: email, // generated ethereal user
          pass: pass, // generated ethereal password
        },
      });

      let info = await transporter.sendMail({
        from: `${from || "Email From"} <${email}>`, // sender address
        to: to, // list of receivers
        subject: subject || "Email", // Subject line
        html: html, // html body
      });

      resolve({ success: true, info });
    } catch (err) {
      resolve({ success: false, err: err.toString() || "Invalid Email" });
    }
  });
}

function addDaysToCurrentTimestamp(days) {
  // Get the current timestamp
  let currentTimestamp = Date.now();

  // Calculate the milliseconds for the given number of days
  let millisecondsToAdd = days * 24 * 60 * 60 * 1000;

  // Add the milliseconds to the current timestamp
  let newTimestamp = currentTimestamp + millisecondsToAdd;

  // Return the new timestamp
  return newTimestamp;
}

// update user plan
async function updateUserPlan(plan, uid) {
  const planDays = parseInt(plan?.days || 0);
  const timeStamp = addDaysToCurrentTimestamp(planDays);
  await query(`UPDATE user SET plan = ?, plan_expire = ? WHERE uid = ?`, [
    JSON.stringify(plan),
    timeStamp,
    uid,
  ]);
}

function getNumberOfDaysFromTimestamp(timestamp) {
  if (!timestamp || isNaN(timestamp)) {
    return 0; // Invalid timestamp
  }

  const currentTimestamp = Date.now();
  if (timestamp <= currentTimestamp) {
    return 0; // Timestamp is in the past or current time
  }

  const millisecondsInADay = 1000 * 60 * 60 * 24;
  const differenceInDays = Math.ceil(
    (timestamp - currentTimestamp) / millisecondsInADay
  );
  return differenceInDays;
}

async function getPlanDetails(uid) {
  const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);
  if (!user) {
    return null;
  } else {
    const plan = user?.plan ? JSON.parse(user.plan) : null;
    return plan;
  }
}

const rzCapturePayment = (paymentId, amount, razorpayKey, razorpaySecret) => {
  // Disable SSL certificate validation
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const auth =
    "Basic " +
    Buffer.from(razorpayKey + ":" + razorpaySecret).toString("base64");

  return new Promise((resolve, reject) => {
    fetch(`https://api.razorpay.com/v1/payments/${paymentId}/capture`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: amount }), // Replace with the actual amount to capture
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.error) {
          console.error("Error capturing payment:", data.error);
          reject(data.error);
        } else {
          console.log("Payment captured successfully:", data);
          resolve(data);
        }
      })
      .catch((error) => {
        console.error("Error capturing payment:", error);
        reject(error);
      });
  });
};

function getUserSignupsByMonth(users) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();

  // Filter users into paid and unpaid arrays
  const { paidUsers, unpaidUsers } = users.reduce(
    (acc, user) => {
      const planExpire = user.plan_expire
        ? new Date(parseInt(user.plan_expire))
        : null;
      const isPaid = planExpire ? planExpire > currentDate : false;
      if (isPaid) {
        acc.paidUsers.push(user);
      } else {
        acc.unpaidUsers.push(user);
      }
      return acc;
    },
    { paidUsers: [], unpaidUsers: [] }
  );

  // Create signups by month for paid users
  const paidSignupsByMonth = months.map((month, monthIndex) => {
    const usersInMonth = paidUsers.filter((user) => {
      const userDate = new Date(user.createdAt);
      return (
        userDate.getMonth() === monthIndex &&
        userDate.getFullYear() === currentYear
      );
    });
    const numberOfSignups = usersInMonth.length;
    const userEmails = usersInMonth.map((user) => user.email);
    return { month, numberOfSignups, userEmails, paid: true };
  });

  // Create signups by month for unpaid users
  const unpaidSignupsByMonth = months.map((month, monthIndex) => {
    const usersInMonth = unpaidUsers.filter((user) => {
      const userDate = new Date(user.createdAt);
      return (
        userDate.getMonth() === monthIndex &&
        userDate.getFullYear() === currentYear
      );
    });
    const numberOfSignups = usersInMonth.length;
    const userEmails = usersInMonth.map((user) => user.email);
    return { month, numberOfSignups, userEmails, paid: false };
  });

  return { paidSignupsByMonth, unpaidSignupsByMonth };
}

function getUserOrderssByMonth(orders = {}) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const signupsByMonth = Array.from({ length: 12 }, (_, monthIndex) => {
    const month = months[monthIndex];
    const ordersInMonth = orders.filter((user) => {
      const userDate = new Date(user.createdAt);
      return (
        userDate.getMonth() === monthIndex &&
        userDate.getFullYear() === currentYear
      );
    });
    const numberOfOders = ordersInMonth.length;
    return { month, numberOfOders };
  });
  return signupsByMonth;
}

async function downloadAndExtractFile(filesObject, outputFolderPath) {
  try {
    // Access the uploaded file from req.files
    const uploadedFile = filesObject.file;
    if (!uploadedFile) {
      return { success: false, msg: "No file data found in FormData" };
    }

    // Create a writable stream to save the file
    const outputPath = path.join(outputFolderPath, uploadedFile.name);

    // Move the file to the desired location
    await new Promise((resolve, reject) => {
      uploadedFile.mv(outputPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Extract the downloaded file
    await fs
      .createReadStream(outputPath)
      .pipe(unzipper.Extract({ path: outputFolderPath })) // Specify the output folder path for extraction
      .promise();

    // Delete the downloaded zip file after extraction
    fs.unlinkSync(outputPath);

    return { success: true, msg: "App was successfully installed/updated" };
  } catch (error) {
    console.error("Error downloading and extracting file:", error);
    return { success: false, msg: error.message };
  }
}

module.exports = {
  isValidEmail,
  getServiceKeys,
  processWebSocketMessage,
  verifyJwt,
  extractHostname,
  normalizeMobileNumber,
  objectToCustomString,
  customStringToObject,
  voiceToken,
  areMobileNumbersFilled,
  parseCSVFile,
  sendTwilioSms,
  writeJsonToFile,
  deleteFileIfExists,
  readJsonFromFile,
  replacePlaceholders,
  makeRequest,
  makeRequestFlow,
  returnNodeAfterAddingVars,
  addPhonebookPrefix,
  ensureFileExists,
  returnOpenaiArr,
  readJSONFile,
  returnOpenAiReply,
  pushToFileArray,
  sendSMSFlow,
  getFileExtension,
  sendEmail,
  updateUserPlan,
  getNumberOfDaysFromTimestamp,
  getPlanDetails,
  rzCapturePayment,
  getUserSignupsByMonth,
  getUserOrderssByMonth,
  folderExists,
  downloadAndExtractFile,
};
