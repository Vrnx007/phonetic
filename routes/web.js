const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const adminValidator = require("../middlewares/admin.js");
const fs = require("fs");
const randomstring = require("randomstring");
const path = require("path");
const {
  getFileExtension,
  isValidEmail,
  folderExists,
  downloadAndExtractFile,
} = require("../functions/function.js");
const { addON, appVersion } = require("../env.js");
const bcrypt = require("bcrypt");

router.get("/get-one-translation", async (req, res) => {
  try {
    const cirDir = process.cwd();
    const code = req.query.code;

    fs.readFile(`${cirDir}/languages/${code}.json`, "utf8", (err, lang) => {
      if (err) {
        console.log("File read failed:", err);
        res.json({ notfound: true });
        return;
      }

      res.json({
        success: true,
        data: JSON.parse(lang),
      });
    });
  } catch (err) {
    res.json({ err, msg: "server error" });
    console.log(err);
  }
});

router.get("/get-all-translation-name", async (req, res) => {
  try {
    const cirDir = `${__dirname}/../languages/`;
    fs.readdir(`${cirDir}`, (err, files) => {
      res.json({ success: true, data: files });
    });
  } catch (err) {
    res.json({
      msg: "Server error",
      err: err,
    });
    console.log(err);
  }
});

router.post("/update-one-translation", adminValidator, async (req, res) => {
  try {
    const cirDir = process.cwd();
    const code = req.body.code;
    const updatedJson = req.body.updatedjson;

    const filePath = path.join(cirDir, "languages", `${code}.json`);

    fs.writeFile(filePath, JSON.stringify(updatedJson), "utf8", (err) => {
      if (err) {
        console.log("File write failed:", err);
        res.json({ success: false, error: err });
        return;
      }
      res.json({
        success: true,
        msg: "Languages updated refresh the page to make effects",
      });
    });
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error" });
    console.log(err);
  }
});

// add new languages
router.post("/add-new-translation", adminValidator, async (req, res) => {
  try {
    const cirDir = process.cwd();
    const newCode = req.body.newcode;

    const sourceFolderPath = path.join(cirDir, "languages");

    fs.readdir(sourceFolderPath, (err, files) => {
      if (err) {
        console.log("Error reading folder:", err);
        res.json({ success: false, error: err });
        return;
      }

      // Filter out non-JSON files
      const jsonFiles = files.filter((file) => file.endsWith(".json"));

      // Select a random JSON file
      const randomIndex = Math.floor(Math.random() * jsonFiles.length);
      const randomFile = jsonFiles[randomIndex];

      const sourceFilePath = path.join(sourceFolderPath, randomFile);
      const destinationFilePath = path.join(
        sourceFolderPath,
        `${newCode}.json`
      );

      // Check if the destination file already exists
      if (fs.existsSync(destinationFilePath)) {
        res.json({ success: false, msg: "Destination file already exists" });
        return;
      }

      // Duplicate the source file to the destination file
      fs.copyFile(sourceFilePath, destinationFilePath, (err) => {
        if (err) {
          console.log("File duplication failed:", err);
          res.json({ success: false, error: err });
          return;
        }
        res.json({
          success: true,
          msg: "Language file duplicated successfully",
        });
      });
    });
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error" });
    console.log(err);
  }
});

// get all langs
router.get("/get-all-translation-name", async (req, res) => {
  try {
    const cirDir = process.cwd();
    fs.readdir(`${cirDir}/languages/`, (err, files) => {
      res.json({ success: true, data: files });
    });
  } catch (err) {
    res.json({
      msg: "Server error",
      err: err,
    });
    console.log(err);
  }
});

// del one lang
router.post("/del-one-translation", adminValidator, async (req, res) => {
  try {
    const cirDir = process.cwd();
    const code = req.body.code;

    const folderPath = path.join(cirDir, "languages");
    const filePath = path.join(folderPath, `${code}.json`);

    // Read the list of files in the "languages" folder
    fs.readdir(folderPath, (err, files) => {
      if (err) {
        console.log("Error reading folder:", err);
        res.json({ success: false, error: err });
        return;
      }

      // Filter out non-JSON files
      const jsonFiles = files.filter((file) => file.endsWith(".json"));

      // Check if there is only one JSON file left
      if (jsonFiles.length === 1) {
        res.json({ success: false, msg: "You cannot delete all languages" });
        return;
      }

      fs.unlink(filePath, (err) => {
        if (err) {
          console.log("File deletion failed:", err);
          res.json({ success: false, error: err });
          return;
        }
        res.json({ success: true, msg: "Language file deleted successfully" });
      });
    });
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error" });
    console.log(err);
  }
});

// get theme
router.get("/get_theme", async (req, res) => {
  try {
    fs.readFile(`${__dirname}/theme.json`, "utf8", (err, lang) => {
      if (err) {
        console.log("File read failed:", err);
        res.json({
          success: false,
          msg: "Somethign went wrong with the theme setting",
        });
        return;
      }

      res.json({
        success: true,
        data: JSON.parse(lang),
      });
    });
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error", err });
    console.log(err);
  }
});

// save theme
router.post("/save_theme", async (req, res) => {
  try {
    const { updatedJson } = req.body;

    const filePath = path.join(`${__dirname}/theme.json`);

    fs.writeFile(filePath, JSON.stringify(updatedJson), "utf8", (err) => {
      if (err) {
        console.log("File write failed:", err);
        res.json({ success: false, error: err });
        return;
      }
      res.json({
        success: true,
        msg: "Theme was updated",
      });
    });
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error", err });
    console.log(err);
  }
});

// update  web config
router.post("/update_web_config", adminValidator, async (req, res) => {
  try {
    const {
      app_name,
      custom_home,
      is_custom_home,
      meta_description,
      currency_code,
      currency_symbol,
      home_page_tutorial,
      chatbot_screen_tutorial,
      broadcast_screen_tutorial,
      login_header_footer,
      exchange_rate,
    } = req.body;

    let filename = "";

    if (req.files) {
      const randomString = randomstring.generate();
      const file = req.files.file;

      filename = `${randomString}.${getFileExtension(file.name)}`;

      file.mv(`${__dirname}/../client/public/media/${filename}`, (err) => {
        if (err) {
          console.log(err);
          return res.json({ err });
        }
      });
    } else {
      filename = req.body?.logo;
    }

    if (!app_name) {
      return res.json({ msg: "Please provide app name" });
    }

    await query(
      `UPDATE web_public SET logo = ?, app_name = ?, custom_home = ?, is_custom_home = ?, meta_description = ?, currency_code = ? , 
        currency_symbol = ?, 
        home_page_tutorial = ?,
        chatbot_screen_tutorial = ?,
        broadcast_screen_tutorial = ?,
        login_header_footer = ?,
        exchange_rate = ?`,
      [
        filename,
        app_name,
        custom_home,
        parseInt(is_custom_home) > 0 ? 1 : 0,
        meta_description,
        currency_code,
        currency_symbol,
        home_page_tutorial,
        chatbot_screen_tutorial,
        broadcast_screen_tutorial,
        login_header_footer,
        exchange_rate,
      ]
    );

    res.json({ success: true, msg: "Web config updated" });
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error", err });
    console.log(err);
  }
});

// get web public
router.get("/get_web_public", async (req, res) => {
  try {
    const data = await query(`SELECT * FROM web_public`, []);
    res.json({ data: data[0], success: true });
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error", err });
    console.log(err);
  }
});

// submit contact form
router.post("/submit_contact_form", async (req, res) => {
  try {
    const { name, mobile, email, content } = req.body;

    if (!name || !mobile || !email || !content) {
      return res.json({ success: false, msg: "Please fill all the fields" });
    }

    if (!isValidEmail(email)) {
      return res.json({ success: false, msg: "Please enter a valid email id" });
    }

    await query(
      `INSERT INTO contact_form (email, name, mobile, content) VALUES (?,?,?,?)`,
      [email, name, mobile, content]
    );

    res.json({
      success: true,
      msg: "Your form has been submitted. We will contat to your asap",
    });
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error", err });
    console.log(err);
  }
});

// check install
router.get("/check_install", async (req, res) => {
  try {
    const filePath = `${__dirname}/../client/public/static`;

    const check = folderExists(filePath);

    if (check) {
      return res.json({ success: true });
    } else {
      return res.json({ success: false });
    }
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error", err });
    console.log(err);
  }
});

// install app
router.post("/install_app", async (req, res) => {
  try {
    const filePath = `${__dirname}/../client/public/static`;

    const check = folderExists(filePath);

    if (check) {
      return res.json({ success: true, msg: "Your app is already installed" });
    }

    const outputPath = `${__dirname}/../client/public`;

    const installApp = await downloadAndExtractFile(req.files, outputPath);

    res.json(installApp);
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error", err });
    console.log(err);
  }
});

router.get("/return_module", async (req, res) => {
  try {
    res.json({ success: true, data: addON || [] });
  } catch (err) {
    res.json({ err, msg: "server error" });
    console.log(err);
  }
});

// get app version
router.get("/get_app_version", async (req, res) => {
  try {
    res.json({ success: true, version: appVersion });
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error", err });
    console.log(err);
  }
});

// update app
router.post("/update_app", async (req, res) => {
  try {
    const { password, newQueries } = req.body;

    if (!password) {
      return res.json({ msg: "Admin password missing", success: false });
    }

    const getAdmin = await query(`SELECT * FROM admin`, []);

    const compare = await bcrypt.compare(password, getAdmin[0].password);
    if (!compare) {
      return res.json({
        msg: "Invalid admin password. Please give a correct admin password",
      });
    }

    if (newQueries && JSON.parse(newQueries)?.length > 0) {
      const newQuery = JSON.parse(newQueries);
      await Promise.all(
        newQuery?.map(async (i) => {
          const { run, check } = i;
          const checkExist = await query(check, []);
          if (checkExist.length < 1) {
            await query(run, []);
          }
        })
      );
    }

    const outputPath = `${__dirname}/../`;

    const installApp = await downloadAndExtractFile(req.files, outputPath);

    res.json(installApp);
  } catch (err) {
    res.json({ success: false, error: err, msg: "Server error", err });
    console.log(err);
  }
});

module.exports = router;
