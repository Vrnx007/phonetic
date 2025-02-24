const WebSocket = require("ws");
const url = require("url");
const randomstring = require("randomstring");
const { destributeSocket } = require("./socket/index");

let wssInstance; // Global variable to store the WebSocket server instance
let connectedUsers = []; // Array to store connected users

function initializeWebSocket(server) {
  const wss = new WebSocket.Server({ server });
  wssInstance = wss;

  wss.onopen = () => {
    console.log("Connected to WebSocket");
  };

  wss.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log(`Speech received for call ${data.id}: ${data.speechResult}`);
  };

  wss.onclose = () => {
    console.log("Disconnected from WebSocket");
  };

  // WebSocket event handling
  wss.on("connection", (ws, req) => {
    const socketId = randomstring.generate(6);

    console.log(`A new socket connection: ${socketId}`);

    const obj = {
      ws,
      id: socketId,
    };

    // Add the user to the connectedUsers array
    connectedUsers.push(obj);

    // Listen for incoming messages
    ws.on("message", async (message) => {
      try {
        const msg = JSON.parse(message);
        if (msg.event === "start") {
          console.log(msg);
        }
        // destributeSocket({ msg, ws, socketId, req, connectedUsers });
      } catch (error) {
        console.log(message);
        console.error("Invalid message format:", error);
      }
    });

    // Handle disconnection
    ws.on("close", () => {
      console.log("A user disconnected");

      // Remove the disconnected user from the array
      connectedUsers = connectedUsers.filter((user) => user.ws !== ws);

      console.log(
        "Connected Users after disconnection:",
        connectedUsers.map((x) => x.socketId)
      );
    });
  });

  return wss;
}

// Export a function to get the WebSocket server instance
function getWSSInstance() {
  return wssInstance;
}

// Export the connected users array
function getConnectedUsers() {
  return connectedUsers;
}

module.exports = { initializeWebSocket, getWSSInstance, getConnectedUsers };
