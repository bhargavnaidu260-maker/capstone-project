const mysql = require("mysql2");

const db = mysql.createConnection({
    host: "127.0.0.1",
    user: "root",
    password: "",
    database: "coinquest aug_db", // must match your MySQL database name exactly
    port: 3306,
    dateStrings: true // return DATE columns as plain "YYYY-MM-DD" strings
});

db.connect((err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
        return;
    }
    console.log("MySQL connected successfully!");
});

module.exports = db;