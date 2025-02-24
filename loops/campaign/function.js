const { VoiceResponse } = require("twilio").twiml;
const twilio = require("twilio");
const { normalizeMobileNumber } = require("../../functions/function");
const { query } = require("../../database/dbpromise");
const { moveOutgoingNext } = require("../../functions/ivrFlow");

function dialTwilio({ device, to, log }) {
  return new Promise(async (resolve) => {
    try {
      const twilioClient = twilio(device?.sid, device.token);

      console.log(
        `Dialing to +${normalizeMobileNumber(to)} from +${normalizeMobileNumber(
          device?.number
        )}`
      );

      const call = await twilioClient.calls.create({
        to: `+${normalizeMobileNumber(to)}`,
        from: `+${normalizeMobileNumber(device?.number)}`,
        url: `${process.env.BACKURI}/api/campaign/ring?device=${device?.device_id}&outgoing=${log.id}`,
        method: "POST",
        // record: true,
      });

      await query(`UPDATE call_campaign_log SET twilio_sid = ? WHERE id = ?`, [
        call.sid,
        log.id,
      ]);
      resolve({ success: true, callSid: call.sid });
    } catch (err) {
      console.log(err);
      resolve({ success: false, msg: err?.toString() });
    }
  });
}

async function updateLog({ id, status }) {
  try {
    await query(`UPDATE call_campaign_log SET status = ? WHERE id = ?`, [
      status,
      id,
    ]);
    await moveOutgoingNext({
      logId: id,
      hangup: true,
      msg: status,
    });
  } catch (err) {
    console.log(err);
    console.log(`Error in updateLog under function.js`);
  }
}

async function makeCall({ user, campaign, log, device }) {
  try {
    const ivrOut = device?.ivr_out ? JSON.parse(device?.ivr_out) : null;

    if (!ivrOut || !ivrOut?.active) {
      console.log("IVR OUT off");
      return;
    }

    await query(`UPDATE call_campaign_log SET status = ? WHERE id = ?`, [
      "STARTED",
      log?.id,
    ]);
    const twilioCall = await dialTwilio({ device, to: log?.call_to, log });
    if (!twilioCall.success) {
      await updateLog({ id: log.id, status: twilioCall?.msg });
    }
  } catch (err) {
    const errMsg = err?.toString();
    await query(`UPDATE call_campaign_log status = ? WHERE id = ?`, [
      errMsg,
      log.id,
    ]);
  }
}

function delay(sec = 5) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, sec * 1000);
  });
}

module.exports = { makeCall, delay };
