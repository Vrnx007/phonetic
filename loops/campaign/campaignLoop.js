const { query } = require("../../database/dbpromise");
const { moveOutgoingNext } = require("../../functions/ivrFlow");
const { delay, makeCall } = require("./function");

// Variable to store the last time logStarted was seen for each user
let lastLogStartTime = {}; // Object to store for each user, keyed by user.uid

// Variable to define the waiting time in minutes
const minToWait = 30; // Change this value to set how many minutes to wait

// Function that continuously runs for each user
async function runForUser(user) {
  try {
    // Get 1 campaign
    const [campaign] = await query(
      `SELECT * FROM call_campaign WHERE uid = ? AND status = ? LIMIT 1`,
      [user?.uid, "INITIATED"]
    );

    if (campaign && parseInt(campaign?.active) > 0) {
      // Getting log
      const [logStarted] = await query(
        `SELECT * FROM call_campaign_log WHERE broadcast_id = ? AND status = ? LIMIT 1`,
        [campaign.campaign_id, "STARTED"]
      );
      const [logCalling] = await query(
        `SELECT * FROM call_campaign_log WHERE broadcast_id = ? AND status = ? LIMIT 1`,
        [campaign.campaign_id, "CALLING"]
      );
      const [logInitiated] = await query(
        `SELECT * FROM call_campaign_log WHERE broadcast_id = ? AND status = ? LIMIT 1`,
        [campaign.campaign_id, "INITIATED"]
      );

      // If logStarted is found
      if (logStarted) {
        const currentTime = Date.now();

        // If this is the first time we're seeing logStarted for this user, store the timestamp
        if (!lastLogStartTime[user.uid]) {
          lastLogStartTime[user.uid] = currentTime;
        }

        const logStartTime = lastLogStartTime[user.uid];

        // Convert minToWait to milliseconds
        const waitTimeInMillis = minToWait * 60 * 1000;

        // Check if it has been continuous minToWait minutes
        if (currentTime - logStartTime >= waitTimeInMillis) {
          // More than minToWait minutes have passed with logStarted being present

          // Run the function only once and reset the tracking
          await someFunctionToCallAfterWait(user, campaign, logStarted);

          // Reset the lastLogStartTime for this user to prevent it from running again
          lastLogStartTime[user.uid] = null;
        }
      } else {
        // If logStarted is not found, reset the time tracking for this user
        lastLogStartTime[user.uid] = null;
      }

      // If no logCalling or logStarted found, update campaign status to COMPLETED
      if (!logCalling && !logStarted && !logInitiated) {
        await query(
          `UPDATE call_campaign SET status = ? WHERE campaign_id = ?`,
          ["COMPLETED", campaign.campaign_id]
        );
      }

      // If logCalling is found but logStarted is not, make a call
      if (logCalling && !logStarted) {
        const deviceData = JSON.parse(logCalling?.device) || null;

        if (deviceData) {
          const [device] = await query(
            `SELECT * FROM device WHERE device_id = ?`,
            [deviceData?.device_id]
          );

          if (device) {
            await makeCall({ user, campaign, log: logCalling, device });
          }
        }
      }

      if (logInitiated && !logCalling) {
        console.log("Ran ji");
        await query(`UPDATE call_campaign_log SET status = ? WHERE id = ?`, [
          "CALLING",
          logInitiated?.id,
        ]);
      }
    }

    // console.log(`User broadcast sleeping for 5 sec`);
  } catch (err) {
    console.error(`Error in runForUser for user ${user.uid}:`, err);
  } finally {
    // Re-run the function for the same user after 5 seconds
    setTimeout(() => {
      runForUser(user);
    }, 5000); // 5 seconds interval
  }
}

// Example of the function to be called after minToWait minutes
async function someFunctionToCallAfterWait(user, campaign, log) {
  console.log(
    `${minToWait} minutes have passed continuously since logStarted for campaign ${campaign.campaign_id} so updating calling`
  );

  await moveOutgoingNext({
    logId: log?.id,
    hangup: true,
    msg: "DISCONNECTED",
  });
  // Add your custom logic here
}

// Function to start the loop for each user
async function startUserLoops() {
  try {
    // Fetching all users from the database
    const users = await query(`SELECT * FROM user`, []);

    if (users.length === 0) {
      console.log("No users found.");
      return;
    }

    users.forEach((user) => {
      runForUser(user); // Start the loop for each user individually
    });
  } catch (err) {
    console.error("Error in startUserLoops:", err);
  }
}

module.exports = { startUserLoops };
