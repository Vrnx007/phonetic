const flow = [
  {
    id: "start",
    message: {
      local: {
        language: {},
        voice: {},
      },
      text: "Hello welcome to codeyon it services, Press 1 for sales and press 2 for support",
      textClosing: "",
    },
    digit: [
      {
        digit: 1,
        id: "id1",
      },
      {
        digit: 2,
        id: "id2",
      },
    ],
    action: [
      {
        name: "callApi",
        url: "some.com",
      },
    ],
  },
  {
    id: "id11",
    message:
      "Thank you for selecting 1 for sales. Please press 1 for SAAS support and press 2 for custom build support",
    digit: [
      {
        digit: 1,
        id: "idd1",
      },
      {
        digit: 2,
        id: "idd2",
      },
    ],
    action: [],
  },
  {
    id: "idd11",
    message:
      "Thank you for selecting 2 for custom build support. we have taken your input good bye",
    digit: [],
    action: [
      {
        name: "disconnect",
      },
    ],
  },
];

const conenction = [
  {
    source: "id1",
    target: "id11",
  },
  {
    source: "idd1",
    target: "idd11",
  },
];
