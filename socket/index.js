const url = require("url");
const atob = require("atob");

function forTwilioIncomingWebhook({
  event,
  msg,
  socketId,
  req,
  connectedUsers,
  ws,
}) {
  const inSocketId = req.url?.split("/")[1] || null;
  if (inSocketId) {
    switch (msg.event) {
      case "connected":
        console.log(
          "a new call has been connected with client socket Id",
          inSocketId
        );
        break;
      case "start":
        console.log(`Starting Media Stream ${msg.streamSid}`);
        break;
      case "media":
        // console.log(`coming media`, msg.media.payload);
        const getWsClient = connectedUsers.filter((x) => x.id === inSocketId);
        if (getWsClient.length > 0) {
          const webSocket = getWsClient[0];
          webSocket.ws.send(
            JSON.stringify({
              action: "return_twilio_stream",
              data: msg.media.payload,
            })
          );
        } else {
          console.log(`looks like the socket is no longer connected`);
        }
        break;
      case "stop":
        console.log(`Call Has Ended`);
        break;
    }
  }

  ws.on("close", () => {
    console.log("WebSocket connection closed with socket id", socketId);
  });
}

async function destributeSocket({ msg, ws, socketId, req, connectedUsers }) {
  try {
    console.log("SOCKET");
    // const event = msg?.event;
    // const action = msg?.action;
    // const data = msg?.data;

    // if (event) {
    //   forTwilioIncomingWebhook({
    //     event,
    //     msg,
    //     socketId,
    //     req,
    //     connectedUsers,
    //     ws,
    //   });
    // }

    // if (action === "get_socket_id") {
    //   ws.send(
    //     JSON.stringify({
    //       data: {
    //         id: socketId,
    //       },
    //       action: "return_socket_id",
    //     })
    //   );
    // }

    // if (event === "return_user") {
    //   ws.send(JSON.stringify(connectedUsers.map((x) => x.id)));
    // }
  } catch (err) {
    console.log(`error in destributeSocket`, err);
  }
}

module.exports = {
  destributeSocket,
};
