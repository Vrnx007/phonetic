require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const fileUpload = require("express-fileupload");
const path = require("path");
const { initializeWebSocket } = require("./socket");
const { startUserLoops } = require("./loops/campaign/campaignLoop");

// Middleware setup
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cors());
app.use(fileUpload());

// routers
const userRoute = require("./routes/user");
app.use("/api/user", userRoute);

const webRoute = require("./routes/web");
app.use("/api/web", webRoute);

const adminRoute = require("./routes/admin");
app.use("/api/admin", adminRoute);

const callRoute = require("./routes/call");
app.use("/api/call", callRoute);

const phonebookRoute = require("./routes/phonebook");
app.use("/api/phonebook", phonebookRoute);

const messageRoute = require("./routes/message");
app.use("/api/message", messageRoute);

const chat_flowRoute = require("./routes/chatFlow");
app.use("/api/chat_flow", chat_flowRoute);

const ivrRoute = require("./routes/ivr");
app.use("/api/ivr", ivrRoute);

const callManager = require("./routes/callManager");
app.use("/api/call_manager", callManager);

const campaign = require("./routes/campaign");
app.use("/api/campaign", campaign);

const agent = require("./routes/agent");
app.use("/api/agent", agent);

const call_force = require("./routes/call_force");
app.use("/api/call_force", call_force);

const plan = require("./routes/plan");
app.use("/api/plan", plan);

// Serve static files
app.use(express.static(path.resolve(__dirname, "./client/public")));

app.get("*", (request, response) => {
  response.sendFile(path.resolve(__dirname, "./client/public", "index.html"));
});

// Start the server
const server = app.listen(process.env.PORT || 3010, () => {
  console.log(`Whatsham server is running on port ${process.env.PORT}`);
  setTimeout(() => {
    startUserLoops();
  }, 5000);
});

// Initialize WebSocket and return the instance
initializeWebSocket(server);
