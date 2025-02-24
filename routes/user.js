const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const {
  isValidEmail,
  getServiceKeys,
  isValidJson,
  updateUserPlan,
  rzCapturePayment,
  getUserOrderssByMonth,
  sendEmail,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { getConnectedUsers } = require("../socket.js");
const { checkPlan, checkDeviceLimit } = require("../middlewares/plan.js");
const Stripe = require("stripe");
const fetch = require("node-fetch");
const { recoverEmail } = require("../emails/returnEmails.js");
const moment = require("moment");

router.get("/", (req, res) => {
  const users = getConnectedUsers();

  res.json(users.map((x) => x.socketId));
});

// signup user
router.post("/signup", async (req, res) => {
  try {
    const { email, name, password, mobile, acceptPolicy } = req.body;

    if (!email || !name || !password || !mobile) {
      return res.json({ msg: "Please fill the details", success: false });
    }

    if (!acceptPolicy) {
      return res.json({
        msg: "You did not click on checkbox of Privacy & Terms",
        success: false,
      });
    }

    if (!isValidEmail(email)) {
      return res.json({ msg: "Please enter a valid email", success: false });
    }

    // check if user already has same email
    const findEx = await query(`SELECT * FROM user WHERE email = ?`, email);
    if (findEx.length > 0) {
      return res.json({ msg: "A user already exist with this email" });
    }

    const haspass = await bcrypt.hash(password, 10);
    const uid = randomstring.generate();

    await query(
      `INSERT INTO user (name, uid, email, password, mobile) VALUES (?,?,?,?,?)`,
      [name, uid, email, haspass, mobile]
    );

    res.json({ msg: "Signup Success", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// login user
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
    const userFind = await query(`SELECT * FROM user WHERE email = ?`, [email]);
    if (userFind.length < 1) {
      return res.json({ msg: "Invalid credentials" });
    }

    const compare = await bcrypt.compare(password, userFind[0].password);

    if (!compare) {
      return res.json({ msg: "Invalid credentials" });
    } else {
      const token = sign(
        {
          uid: userFind[0].uid,
          role: "user",
          password: userFind[0].password,
          email: userFind[0].email,
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

// add device
router.post(
  "/add_device",
  validateUser,
  checkPlan,
  checkDeviceLimit,
  async (req, res) => {
    try {
      const {
        sid,
        title,
        api_key,
        api_secret,
        number,
        outgoing_app_sid,
        token,
        status,
        other,
      } = req.body;

      const deviceId = randomstring.generate(5);

      if (
        !sid ||
        !api_key ||
        !number ||
        !title ||
        !api_secret ||
        !outgoing_app_sid ||
        !token
      ) {
        return res.json({ msg: "Please fill the details" });
      }

      await query(
        `INSERT INTO device (uid, device_id, title, sid, token, api_key, api_secret, outgoing_app_sid, number) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          req.decode.uid,
          deviceId,
          title,
          sid,
          token,
          api_key,
          api_secret,
          outgoing_app_sid,
          number,
        ]
      );

      res.json({ success: true, msg: "Your device has been added" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// get all devices
router.get("/get_my_devices", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM device WHERE uid = ?`, [
      req.decode.uid,
    ]);

    const newData = data.map((x) => {
      return {
        ...x,
        webhookUrl: `${process.env.BACKURI}/api/message/msg/${x.device_id}`,
      };
    });

    res.json({ data: newData, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update device
router.post("/update_device", validateUser, async (req, res) => {
  try {
    const {
      sid,
      title,
      api_key,
      api_secret,
      outgoing_app_sid,
      number,
      id,
      token,
    } = req.body;

    if (
      !sid ||
      !api_key ||
      !number ||
      !title ||
      !api_secret ||
      !outgoing_app_sid ||
      !token
    ) {
      return res.json({ msg: "Please fill the details" });
    }

    await query(
      `UPDATE device SET sid = ?, token = ?, title = ?, api_key = ?, api_secret = ?, outgoing_app_sid = ?, number = ? WHERE uid = ? AND id = ?`,
      [
        sid,
        token,
        title,
        api_key,
        api_secret,
        outgoing_app_sid,
        number,
        req.decode.uid,
        id,
      ]
    );

    res.json({ success: true, msg: "Device updated" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del device
router.post("/del_device", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`DELETE FROM device WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({ success: true, msg: "Device was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// add model
router.post("/add_model", validateUser, async (req, res) => {
  try {
    const {
      title,
      value,
      openai_model,
      temprature,
      max_token,
      train_text,
      history_number,
    } = req.body;

    if (!title || !train_text) {
      return res.json({ msg: "Please fill title and train text" });
    }

    const aiType = parseInt(value) > 0 ? "gemini" : "openai";

    await query(
      `INSERT INTO model (uid, title, type, model_code, temprature, max_token, train_text, history_number) VALUES (?,?,?,?,?,?,?,?)`,
      [
        req.decode.uid,
        title,
        aiType,
        openai_model,
        temprature,
        max_token,
        train_text,
        history_number || 0,
      ]
    );

    res.json({ success: true, msg: "Your model was added" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get my ai models
router.get("/get_my_ai_model", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM model WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update model ai
router.post("/update_ai_model", validateUser, async (req, res) => {
  try {
    const {
      title,
      type,
      model_code,
      temprature,
      max_token,
      train_text,
      history_number,
      id,
    } = req.body;

    if (!title || !train_text) {
      return res.json({ msg: "Please fill model title and train text" });
    }

    await query(
      `UPDATE model SET title = ?, model_code = ?, temprature = ?, max_token = ?, train_text = ?, history_number = ? WHERE id = ?`,
      [title, model_code, temprature, max_token, train_text, history_number, id]
    );

    res.json({ msg: "Model was updated", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del ai model
router.post("/del_ai_model", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM model WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({ msg: "Model weas deleted", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get service api keys
router.get("/get_service_api_keys", validateUser, async (req, res) => {
  try {
    const { geminiAi, openai, googleCloud } = await getServiceKeys({
      uid: req.decode.uid,
    });

    res.json({
      success: true,
      data: { geminiAi, openai, googleCloud },
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update service keys
router.post("/update_service_keys", validateUser, async (req, res) => {
  try {
    const { geminiAi, openai, googleCloud } = req.body;

    // if (googleCloud && !isValidJson(googleCloud)) {
    //   return res.json({
    //     msg: "Please make sure your google cloud credentials are corretly formated.",
    //   });
    // }

    const keys = await getServiceKeys({
      uid: req.decode.uid,
    });

    if (keys.geminiAi) {
      if (!geminiAi) {
        return res.json({ msg: "Gemini API can not be blank" });
      }
      await query(`UPDATE ai_key SET data = ? WHERE uid = ? AND key_type = ?`, [
        geminiAi,
        req.decode.uid,
        "gemini",
      ]);
    } else {
      await query(`INSERT INTO ai_key (uid, key_type, data) VALUES (?,?,?)`, [
        req.decode.uid,
        "gemini",
        geminiAi,
      ]);
    }

    if (keys.openai) {
      if (!openai) {
        return res.json({ msg: "OpenAi API can not be blank" });
      }
      await query(`UPDATE ai_key SET data = ? WHERE uid = ? AND key_type = ?`, [
        openai,
        req.decode.uid,
        "openai",
      ]);
    } else {
      await query(`INSERT INTO ai_key (uid, key_type, data) VALUES (?,?,?)`, [
        req.decode.uid,
        "openai",
        openai,
      ]);
    }

    if (keys.googleCloud) {
      if (!googleCloud) {
        return res.json({ msg: "Google CLoud credentials can not be blank" });
      }
      await query(`UPDATE ai_key SET data = ? WHERE uid = ? AND key_type = ?`, [
        googleCloud,
        req.decode.uid,
        "google-cloud",
      ]);
    } else {
      await query(`INSERT INTO ai_key (uid, key_type, data) VALUES (?,?,?)`, [
        req.decode.uid,
        "google-cloud",
        googleCloud,
      ]);
    }

    res.json({ success: true, msg: "Keys updated" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get me
router.get("/get_me", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data: data[0], success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get my flow captures
router.get("/get_my_flow_captures", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM flow_response WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del capture info
router.post("/del_captured_info", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    console.log(req.body);
    await query(`DELETE FROM flow_response WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ success: true, msg: "Enter was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update profile
router.post("/update_profile", validateUser, async (req, res) => {
  try {
    const { newPassword, name, mobile, email, user_timezone } = req.body;

    if (!name || !mobile || !email || !user_timezone) {
      return res.json({
        msg: "Name, Mobile, Email, Timezone are required fields",
      });
    }

    if (newPassword) {
      const hash = await bcrypt.hash(newPassword, 10);
      await query(
        `UPDATE user SET name = ?, email = ?, password = ?, mobile = ?, user_timezone = ? WHERE uid = ?`,
        [name, email, hash, mobile, user_timezone, req.decode.uid]
      );
    } else {
      await query(
        `UPDATE user SET name = ?, email = ?, mobile = ?, user_timezone = ? WHERE uid = ?`,
        [name, email, mobile, user_timezone, req.decode.uid]
      );
    }

    res.json({ success: true, msg: "Profile was updated" });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// get plan detail
router.post("/get_plan_details", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    const data = await query(`SELECT * FROM plan WHERE id = ?`, [id]);
    if (data.length < 1) {
      return res.json({ success: false, data: null });
    } else {
      res.json({ success: true, data: data[0] });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get payment gateway
router.get("/get_payment_details", validateUser, async (req, res) => {
  try {
    const resp = await query(`SELECT * FROM web_private`, []);
    let data = resp[0];

    data.pay_stripe_key = "";
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

function checlStripePayment(orderId) {
  return new Promise(async (resolve) => {
    try {
      const getStripe = await query(`SELECT * FROM web_private`, []);

      const stripeClient = new Stripe(getStripe[0]?.pay_stripe_key);
      const getPay = await stripeClient.checkout.sessions.retrieve(orderId);

      console.log({ status: getPay?.payment_status });

      if (getPay?.payment_status === "paid") {
        resolve({ success: true, data: getPay });
      } else {
        resolve({ success: false });
      }
    } catch (err) {
      resolve({ success: false, data: {} });
    }
  });
}

function returnHtmlRes(msg) {
  const html = `<!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="refresh" content="5;url=${process.env.FRONTENDURI}/user">
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
          text-align: center;
          margin: 0;
          padding: 0;
        }

        .container {
          background-color: #ffffff;
          border: 1px solid #ccc;
          border-radius: 4px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          margin: 100px auto;
          padding: 20px;
          width: 300px;
        }

        p {
          font-size: 18px;
          color: #333;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <p>${msg}</p>
      </div>
    </body>
    </html>
    `;
  return html;
}

router.get("/stripe_payment", async (req, res) => {
  try {
    const { order, plan } = req.query;

    if (!order || !plan) {
      return res.send("INVALID REQUEST");
    }

    const getOrder = await query(`SELECT * FROM orders WHERE data = ?`, [
      order || "",
    ]);
    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan]);

    if (getOrder.length < 1) {
      return res.send("Invalid payment found");
    }

    if (getPlan.length < 1) {
      return res.send("Invalid plan found");
    }

    const checkPayment = await checlStripePayment(getOrder[0]?.s_token);
    console.log({ checkPayment: checkPayment });

    if (checkPayment.success) {
      res.send(returnHtmlRes("Payment Success! Redirecting..."));

      await query(`UPDATE orders SET data = ? WHERE data = ?`, [
        JSON.stringify(checkPayment?.data),
        order,
      ]);

      await updateUserPlan(getPlan[0], getOrder[0]?.uid);
    } else {
      res.send(
        "Payment Failed! If the balance was deducted please contact to the HamWiz support. Redirecting..."
      );
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// creating stripe pay session
router.post("/create_stripe_session", validateUser, async (req, res) => {
  try {
    const getWeb = await query(`SELECT * FROM web_private`, []);

    if (
      getWeb.length < 1 ||
      !getWeb[0]?.pay_stripe_key ||
      !getWeb[0]?.pay_stripe_id
    ) {
      return res.json({
        success: false,
        msg: "Opss.. payment keys found not found",
      });
    }

    const stripeKeys = getWeb[0]?.pay_stripe_key;

    const stripeClient = new Stripe(stripeKeys);

    const { planId } = req.body;

    const plan = await query(`SELECT * FROM plan WHERE id = ?`, [planId]);

    if (plan.length < 1) {
      return res.json({ msg: "No plan found with the id" });
    }

    const randomSt = randomstring.generate();
    const orderID = `STRIPE_${randomSt}`;

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "STRIPE", plan[0]?.price, orderID]
    );

    const web = await query(`SELECT * FROM web_public`, []);

    const productStripe = [
      {
        price_data: {
          currency: web[0]?.currency_code,
          product_data: {
            name: plan[0]?.title,
            // images:[product.imgdata]
          },
          unit_amount: plan[0]?.price * 100,
        },
        quantity: 1,
      },
    ];

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: productStripe,
      mode: "payment",
      success_url: `${process.env.BACKURI}/api/user/stripe_payment?order=${orderID}&plan=${plan[0]?.id}`,
      cancel_url: `${process.env.BACKURI}/api/user/stripe_payment?order=${orderID}&plan=${plan[0]?.id}`,
      locale: process.env.STRIPE_LANG || "en",
    });

    await query(`UPDATE orders SET s_token = ? WHERE data = ?`, [
      session?.id,
      orderID,
    ]);

    res.json({ success: true, session: session });
  } catch (err) {
    res.json({ msg: err.toString(), err });
    console.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

// enroll free plan
router.post("/start_free_trial", validateUser, async (req, res) => {
  try {
    const { planId } = req.body;

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (getUser[0]?.trial > 0) {
      return res.json({
        success: false,
        msg: "You have already taken Trial once. You can not enroll for trial again.",
      });
    }

    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [planId]);
    if (getPlan.length < 1) {
      return res.json({ msg: "Invalid plan found" });
    }

    if (getPlan[0]?.price > 0) {
      return res.json({ msg: "This plan is not a trial plan." });
    }
    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "OFFLINE", 0, JSON.stringify({ plan: getPlan[0] })]
    );

    await updateUserPlan(getPlan[0], getUser[0]?.uid);

    await query(`UPDATE user SET trial = ? WHERE uid = ?`, [1, req.decode.uid]);

    res.json({
      success: true,
      msg: "Your trial plan has been activated. You are redirecting to the panel...",
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

router.post("/pay_with_rz", validateUser, async (req, res) => {
  try {
    const { rz_payment_id, plan, amount } = req.body;
    if (!rz_payment_id || !plan || !amount) {
      return res.json({ msg: "please send required fields" });
    }

    // getting plan
    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan?.id]);

    if (getPlan.length < 1) {
      return res.json({
        msg: "Invalid plan found",
      });
    }

    // getting private web
    const [webPrivate] = await query(`SELECT * from web_private`, []);
    const [webPublic] = await query(`SELECT * FROM web_public`, []);

    const rzId = webPrivate?.rz_id;
    const rzKeys = webPrivate?.rz_key;

    if (!rzId || !rzKeys) {
      return res.json({
        msg: `Please fill your razorpay credentials! if: ${rzId} keys: ${rzKeys}`,
      });
    }

    const finalamt =
      (parseInt(amount) / parseInt(webPublic.exchange_rate)) * 80;

    const resp = await rzCapturePayment(
      rz_payment_id,
      Math.round(finalamt) * 100,
      rzId,
      rzKeys
    );

    if (!resp) {
      res.json({ success: false, msg: resp.description });
      return;
    }

    await updateUserPlan(getPlan[0], req.decode.uid);

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "RAZORPAY", plan?.price, JSON.stringify(resp)]
    );

    res.json({
      success: true,
      msg: "Thank for your payment you are good to go now.",
    });
  } catch (err) {
    res.json({ msg: err.toString(), err });
    console.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

// pay with paypal
router.post("/pay_with_paypal", validateUser, async (req, res) => {
  try {
    const { orderID, plan } = req.body;

    if (!plan || !orderID) {
      return res.json({ msg: "order id and plan required" });
    }

    // getting plan
    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan?.id]);

    if (getPlan.length < 1) {
      return res.json({
        msg: "Invalid plan found",
      });
    }

    // getting private web
    const [webPrivate] = await query(`SELECT * from web_private`, []);

    const paypalClientId = webPrivate?.pay_paypal_id;
    const paypalClientSecret = webPrivate?.pay_paypal_key;

    if (!paypalClientId || !paypalClientSecret) {
      return res.json({
        msg: "Please provide paypal ID and keys from the Admin",
      });
    }

    let response = await fetch(
      "https://api.sandbox.paypal.com/v1/oauth2/token",
      {
        method: "POST",
        body: "grant_type=client_credentials",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${paypalClientId}:${paypalClientSecret}`,
              "binary"
            ).toString("base64"),
        },
      }
    );

    let data = await response.json();

    let resp_order = await fetch(
      `https://api.sandbox.paypal.com/v1/checkout/orders/${orderID}`,
      {
        method: "GET",
        headers: {
          Authorization: "Bearer " + data.access_token,
        },
      }
    );

    let order_details = await resp_order.json();

    if (order_details.status === "COMPLETED") {
      await updateUserPlan(getPlan[0], req.decode.uid);

      await query(
        `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
        [req.decode.uid, "PAYPAL", plan?.price, JSON.stringify(order_details)]
      );

      res.json({
        success: true,
        msg: "Thank for your payment you are good to go now.",
      });
    } else {
      res.json({ success: false, msg: "error_description" });
      return;
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// get dashboard
router.get("/get_dashboard", validateUser, async (req, res) => {
  try {
    const agentCalls = await query(
      `SELECT * FROM call_force_log WHERE uid = ?`,
      [req.decode.uid]
    );
    const gettingInitiated = agentCalls.filter((x) => x.status === "INITIATED");

    const gettingCompleted = agentCalls.filter(
      (item) => !gettingInitiated.includes(item)
    );

    const brodcaslCalls = await query(
      `SELECT * FROM call_campaign_log WHERE uid = ?`,
      [req.decode.uid]
    );

    const gettingInitiatedBroadcast = brodcaslCalls.filter(
      (x) => x.status === "INITIATED"
    );

    const gettingCompletedBroadcast = brodcaslCalls.filter(
      (item) => !gettingInitiated.includes(gettingInitiatedBroadcast)
    );

    const agentInitiated = getUserOrderssByMonth(gettingInitiated);
    const agentCompleted = getUserOrderssByMonth(gettingCompleted);
    const broadcastInitiated = getUserOrderssByMonth(gettingInitiatedBroadcast);
    const broadcastCompleted = getUserOrderssByMonth(gettingCompletedBroadcast);

    const [agentIncoming] = await query(
      `SELECT COUNT(*) AS total FROM agent_incoming WHERE owner_uid = ?`,
      [req.decode.uid]
    );

    const [totalCampaign] = await query(
      `SELECT COUNT(*) AS total FROM call_campaign WHERE uid = ?`,
      [req.decode.uid]
    );

    const [totalDevices] = await query(
      `SELECT COUNT(*) AS total FROM device WHERE uid = ?`,
      [req.decode.uid]
    );

    const [totlaCallForceTask] = await query(
      `SELECT COUNT(*) AS total FROM call_force_task WHERE uid = ?`,
      [req.decode.uid]
    );

    const [totalFlowResponse] = await query(
      `SELECT COUNT(*) AS total FROM flow_response WHERE uid = ?`,
      [req.decode.uid]
    );

    const [totalContacts] = await query(
      `SELECT COUNT(*) AS total FROM contact WHERE uid = ?`,
      [req.decode.uid]
    );

    res.json({
      success: true,
      agentInitiated,
      agentCompleted,
      broadcastInitiated,
      broadcastCompleted,
      agentIncoming: agentIncoming.total,
      totalCampaign: totalCampaign.total,
      totalDevices: totalDevices.total,
      totlaCallForceTask: totlaCallForceTask.total,
      totalFlowResponse: totalFlowResponse.total,
      totalContacts: totalContacts.total,
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// send recover
router.post("/send_resovery", async (req, res) => {
  try {
    const { email } = req.body;

    if (!isValidEmail(email)) {
      return res.json({ msg: "Please enter a valid email" });
    }

    const checkEmailValid = await query(`SELECT * FROM user WHERE email = ?`, [
      email,
    ]);
    if (checkEmailValid.length < 1) {
      return res.json({
        success: true,
        msg: "We have sent a recovery link if this email is associated with user account.",
      });
    }

    const getWeb = await query(`SELECT * FROM web_public`, []);
    const appName = getWeb[0]?.app_name;

    const jsontoken = sign(
      {
        old_email: email,
        email: email,
        time: moment(new Date()),
        password: checkEmailValid[0]?.password,
        role: "user",
      },
      process.env.JWTKEY,
      {}
    );

    const recpveryUrl = `${process.env.FRONTENDURI}/recovery-user/${jsontoken}`;

    const getHtml = recoverEmail(appName, recpveryUrl);

    // getting smtp
    const smtp = await query(`SELECT * FROM smtp`, []);
    if (
      !smtp[0]?.email ||
      !smtp[0]?.host ||
      !smtp[0]?.port ||
      !smtp[0]?.password
    ) {
      return res.json({
        success: false,
        msg: "SMTP connections not found! Unable to send recovery link",
      });
    }

    await sendEmail(
      smtp[0]?.host,
      smtp[0]?.port,
      smtp[0]?.email,
      smtp[0]?.password,
      getHtml,
      `${appName} - Password Recovery`,
      smtp[0]?.email,
      email
    );

    res.json({
      success: true,
      msg: "We have sent your a password recovery link. Please check your email",
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// modify recpvery passwrod
router.get("/modify_password", validateUser, async (req, res) => {
  try {
    const { pass } = req.query;

    if (!pass) {
      return res.json({ success: false, msg: "Please provide a password" });
    }

    if (moment(req.decode.time).diff(moment(new Date()), "hours") > 1) {
      return res.json({ success: false, msg: "Token expired" });
    }

    const hashpassword = await bcrypt.hash(pass, 10);

    const result = await query(`UPDATE user SET password = ? WHERE email = ?`, [
      hashpassword,
      req.decode.old_email,
    ]);

    res.json({
      success: true,
      msg: "Your password has been changed. You may login now! Redirecting...",
      data: result,
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

module.exports = router;
