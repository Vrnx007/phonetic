const con = require("./config");

function query(sql, arr) {
  return new Promise((resolve, reject) => {
    if (!sql || !arr) {
      return resolve("No sql provided");
    }
    con.query(sql, arr, (err, result) => {
      if (err) {
        console.log(err);
        return reject(err);
      } else {
        return resolve(result);
      }
    });
  });
}

exports.query = query;
