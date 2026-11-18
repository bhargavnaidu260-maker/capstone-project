const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

// TEST SERVER
app.get("/", (req, res) => {
    res.send("CoinQuest server is running!");
});

// TEST REGISTER ROUTE
app.get("/api/register", (req, res) => {
    res.json({
        message: "Register API is working!"
    });
});

// REGISTER USER
app.post("/api/register", (req, res) => {

    const { name, email, password } = req.body;

    console.log("Registration request received for:", req.body.email);

    if (!name || !email || !password) {
        return res.status(400).json({
            message: "Please fill all required fields"
        });
    }

    const sql =
        "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";

    db.query(
        sql, [name, email, password],
        (err, result) => {

            if (err) {

                console.error("Registration error:", err);

                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(409).json({
                        message: "Email already registered"
                    });
                }

                return res.status(500).json({
                    message: "Registration failed"
                });
            }

            return res.status(201).json({
                message: "Account created successfully!",
                userId: result.insertId
            });
        }
    );
});


// LOGIN USER
app.post("/api/login", (req, res) => {

    const { email, password } = req.body;

    console.log("Login request received for:", req.body.email);

    if (!email || !password) {
        return res.status(400).json({
            message: "Please enter email and password"
        });
    }

    const sql =
        "SELECT id, name, email FROM users WHERE email = ? AND password = ?";

    db.query(
        sql, [email.trim(), password],
        (err, results) => {

            if (err) {
                console.error("Login error:", err);

                return res.status(500).json({
                    message: "Login failed"
                });
            }

            if (results.length === 0) {
                return res.status(401).json({
                    message: "Invalid email or password"
                });
            }

            return res.status(200).json({
                message: "Login successful!",
                user: results[0]
            });
        }
    );
});

// SAVE MONTHLY BUDGET
app.post("/api/budget", (req, res) => {
    const { email, amount } = req.body;

    if (!email || !amount || amount <= 0) {
        return res.status(400).json({
            message: "Email and valid budget amount are required"
        });
    }

    // Find the logged-in user
    db.query(
        "SELECT id FROM users WHERE email = ?", [email],
        (err, users) => {
            if (err) {
                console.error("User lookup error:", err);
                return res.status(500).json({
                    message: "Database error"
                });
            }

            if (users.length === 0) {
                return res.status(404).json({
                    message: "User not found"
                });
            }

            const userId = users[0].id;

            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();

            // Check whether this user already has a monthly budget
            db.query(
                `SELECT id FROM budgets
                 WHERE user_id = ?
                 AND category = 'Monthly'
                 AND month = ?
                 AND year = ?`, [userId, month, year],
                (err, rows) => {
                    if (err) {
                        console.error("Budget lookup error:", err);
                        return res.status(500).json({
                            message: "Database error"
                        });
                    }

                    if (rows.length > 0) {
                        // Update existing budget
                        db.query(
                            `UPDATE budgets
                             SET amount = ?
                             WHERE id = ?`, [amount, rows[0].id],
                            (err) => {
                                if (err) {
                                    console.error("Budget update error:", err);
                                    return res.status(500).json({
                                        message: "Budget update failed"
                                    });
                                }

                                console.log("Budget updated:", amount);

                                res.json({
                                    message: "Budget updated successfully"
                                });
                            }
                        );
                    } else {
                        // Create new budget
                        db.query(
                            `INSERT INTO budgets
                             (user_id, category, amount, spent, month, year)
                             VALUES (?, 'Monthly', ?, 0, ?, ?)`, [userId, amount, month, year],
                            (err, result) => {
                                if (err) {
                                    console.error("Budget insert error:", err);
                                    return res.status(500).json({
                                        message: "Budget save failed"
                                    });
                                }

                                console.log(
                                    "Budget saved. ID:",
                                    result.insertId
                                );

                                res.status(201).json({
                                    message: "Budget saved successfully",
                                    budgetId: result.insertId
                                });
                            }
                        );
                    }
                }
            );
        }
    );
});


// ---------- EXPENSES (real-time dashboard data) ----------
db.query(`CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    category VARCHAR(50) NOT NULL,
    expense_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (user_id, expense_date)
)`, (err) => {
    if (err) console.error("Could not create expenses table:", err.message);
});

db.query(`CREATE TABLE IF NOT EXISTS bill_splits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT NOT NULL,
    description VARCHAR(255) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    participant_count INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (sender_id, created_at),
    FOREIGN KEY (sender_id) REFERENCES users(id)
)`, (err) => {
    if (err) console.error("Could not create bill_splits table:", err.message);
});

db.query(`CREATE TABLE IF NOT EXISTS split_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    split_id INT NOT NULL,
    sender_id INT NOT NULL,
    recipient_id INT NOT NULL,
    amount_due DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP NULL DEFAULT NULL,
    INDEX (recipient_id, read_at, created_at),
    FOREIGN KEY (split_id) REFERENCES bill_splits(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (recipient_id) REFERENCES users(id)
)`, (err) => {
    if (err) console.error("Could not create split_notifications table:", err.message);
});

function withUser(email, res, cb) {
    if (!email) return res.status(400).json({ message: "Email is required" });
    db.query("SELECT id FROM users WHERE email = ?", [email], (err, rows) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (rows.length === 0) return res.status(404).json({ message: "User not found" });
        cb(rows[0].id);
    });
}

// SEND A SPLIT REQUEST TO REGISTERED USERS
app.post("/api/splits", (req, res) => {
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const description = String(body.description || "").trim();
    const totalAmount = Number(body.totalAmount);
    const recipientEmails = Array.isArray(body.recipients)
        ? Array.from(new Set(body.recipients.map((value) => String(value).trim().toLowerCase()).filter(Boolean)))
        : [];
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!description || description.length > 255 || !Number.isFinite(totalAmount) || totalAmount <= 0 || totalAmount > 99999999.99) {
        return res.status(400).json({ message: "Enter a description and a valid bill amount" });
    }
    if (!recipientEmails.length || recipientEmails.length > 20 || recipientEmails.some((recipient) => !validEmail.test(recipient))) {
        return res.status(400).json({ message: "Enter 1 to 20 valid registered recipient emails" });
    }
    if (recipientEmails.includes(email)) {
        return res.status(400).json({ message: "You cannot send a split request to yourself" });
    }

    withUser(email, res, (senderId) => {
        const placeholders = recipientEmails.map(() => "?").join(", ");
        db.query(
            `SELECT id, email FROM users WHERE email IN (${placeholders})`,
            recipientEmails,
            (lookupError, recipients) => {
                if (lookupError) {
                    console.error("Split recipient lookup error:", lookupError);
                    return res.status(500).json({ message: "Could not find split recipients" });
                }
                if (recipients.length !== recipientEmails.length) {
                    return res.status(404).json({ message: "One or more recipient emails are not registered" });
                }

                const participantCount = recipients.length + 1;
                const amountPerPerson = Number((totalAmount / participantCount).toFixed(2));
                db.query(
                    "INSERT INTO bill_splits (sender_id, description, total_amount, participant_count) VALUES (?, ?, ?, ?)",
                    [senderId, description, totalAmount, participantCount],
                    (splitError, splitResult) => {
                        if (splitError) {
                            console.error("Split save error:", splitError);
                            return res.status(500).json({ message: "Could not save split request" });
                        }

                        const values = recipients.map((recipient) => [
                            splitResult.insertId,
                            senderId,
                            recipient.id,
                            amountPerPerson
                        ]);
                        const notificationPlaceholders = values.map(() => "(?, ?, ?, ?)").join(", ");
                        const notificationValues = values.reduce((all, row) => all.concat(row), []);
                        db.query(
                            `INSERT INTO split_notifications (split_id, sender_id, recipient_id, amount_due) VALUES ${notificationPlaceholders}`,
                            notificationValues,
                            (notificationError) => {
                                if (notificationError) {
                                    console.error("Split notification save error:", notificationError);
                                    db.query("DELETE FROM bill_splits WHERE id = ?", [splitResult.insertId], (cleanupError) => {
                                        if (cleanupError) console.error("Split cleanup error:", cleanupError);
                                        return res.status(500).json({ message: "Could not notify split recipients" });
                                    });
                                    return;
                                }
                                res.status(201).json({
                                    splitId: splitResult.insertId,
                                    recipientCount: recipients.length,
                                    participantCount,
                                    amountPerPerson
                                });
                            }
                        );
                    }
                );
            }
        );
    });
});

// LIST UNREAD SPLIT NOTIFICATIONS FOR A USER
app.get("/api/notifications", (req, res) => {
    withUser(req.query.email, res, (userId) => {
        db.query(
            `SELECT n.id, n.amount_due, n.created_at, s.description, sender.name AS sender_name
             FROM split_notifications n
             JOIN bill_splits s ON s.id = n.split_id
             JOIN users sender ON sender.id = n.sender_id
             WHERE n.recipient_id = ? AND n.read_at IS NULL
             ORDER BY n.created_at DESC
             LIMIT 50`,
            [userId],
            (err, rows) => {
                if (err) {
                    console.error("Notification lookup error:", err);
                    return res.status(500).json({ message: "Could not load notifications" });
                }
                res.set("Cache-Control", "no-store");
                res.json({
                    notifications: rows.map((row) => ({
                        id: row.id,
                        amountDue: Number(row.amount_due),
                        createdAt: row.created_at,
                        description: row.description,
                        senderName: row.sender_name
                    }))
                });
            }
        );
    });
});

// MARK A SPLIT NOTIFICATION AS READ
app.post("/api/notifications/:id/read", (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ message: "Invalid notification ID" });
    }
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    withUser(email, res, (userId) => {
        db.query(
            "UPDATE split_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND recipient_id = ? AND read_at IS NULL",
            [req.params.id, userId],
            (err, result) => {
                if (err) {
                    console.error("Notification update error:", err);
                    return res.status(500).json({ message: "Could not update notification" });
                }
                if (!result.affectedRows) return res.status(404).json({ message: "Unread notification not found" });
                res.json({ message: "Notification marked as read" });
            }
        );
    });
});

// LIVE MONTHLY LEADERBOARD
app.get("/api/leaderboard", (req, res) => {
    withUser(req.query.email, res, (currentUserId) => {
        const now = new Date();
        const today = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0")
        ].join("-");
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const weekStartDate = new Date(now);
        weekStartDate.setDate(weekStartDate.getDate() - 6);
        const weekStart = [
            weekStartDate.getFullYear(),
            String(weekStartDate.getMonth() + 1).padStart(2, "0"),
            String(weekStartDate.getDate()).padStart(2, "0")
        ].join("-");
        const rangeStart = weekStart < monthStart ? weekStart : monthStart;
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

        const sql = `
            SELECT u.id, u.name, COALESCE(b.amount, 0) AS budget,
                   COALESCE(SUM(CASE WHEN e.expense_date >= ? THEN e.amount ELSE 0 END), 0) AS month_spent,
                   COUNT(DISTINCT CASE WHEN e.expense_date >= ? THEN e.expense_date END) AS logged_days,
                   COALESCE(SUM(CASE WHEN e.expense_date >= ? THEN 1 ELSE 0 END), 0) AS month_expense_count
            FROM users u
            LEFT JOIN budgets b
                ON b.user_id = u.id AND b.category = 'Monthly' AND b.month = ? AND b.year = ?
            LEFT JOIN expenses e
                ON e.user_id = u.id AND e.expense_date BETWEEN ? AND ?
            GROUP BY u.id, u.name, b.amount
        `;

        db.query(sql, [
            monthStart,
            weekStart,
            monthStart,
            now.getMonth() + 1,
            now.getFullYear(),
            rangeStart,
            today
        ], (err, rows) => {
            if (err) {
                console.error("Leaderboard query error:", err);
                return res.status(500).json({ message: "Could not load leaderboard" });
            }

            const entries = rows
                .map((row) => {
                    const budget = Number(row.budget);
                    const spent = Number(row.month_spent);
                    const expenseCount = Number(row.month_expense_count);
                    let score = 0;

                    if (budget > 0 && expenseCount > 0) {
                        const expected = budget * now.getDate() / daysInMonth;
                        const pace = spent / expected;
                        const paceScore = pace <= 1 ? 1 : Math.max(0, 2 - pace);
                        const savingsRate = Math.max(0, Math.min(1, (budget - spent) / budget));
                        score = Math.round(500 * paceScore + 300 * savingsRate + 200 * Number(row.logged_days) / 7);
                    }

                    const name = String(row.name || "");
                    const initials = name
                        .trim()
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0] || "")
                        .join("")
                        .slice(0, 2)
                        .toUpperCase() || "U";

                    return {
                        name,
                        initials,
                        score,
                        eligible: budget > 0 && expenseCount > 0,
                        isCurrentUser: Number(row.id) === Number(currentUserId)
                    };
                })
                .filter((entry) => entry.eligible)
                .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
                .map(({ eligible, ...entry }, index) => ({ ...entry, rank: index + 1 }));

            res.set("Cache-Control", "no-store");
            res.json({
                month: now.getMonth() + 1,
                year: now.getFullYear(),
                entries
            });
        });
    });
});

// GET CURRENT MONTH BUDGET
app.get("/api/budget", (req, res) => {
    withUser(req.query.email, res, (userId) => {
        const now = new Date();
        db.query(
            "SELECT amount FROM budgets WHERE user_id = ? AND category = 'Monthly' AND month = ? AND year = ?", [userId, now.getMonth() + 1, now.getFullYear()],
            (err, rows) => {
                if (err) return res.status(500).json({ message: "Database error" });
                res.json({ amount: rows.length ? Number(rows[0].amount) : 0 });
            }
        );
    });
});

// LIST EXPENSES
app.get("/api/expenses", (req, res) => {
    withUser(req.query.email, res, (userId) => {
        db.query(
            "SELECT id, description, amount, category, expense_date, created_at FROM expenses WHERE user_id = ? ORDER BY expense_date DESC, id DESC", [userId],
            (err, rows) => {
                if (err) return res.status(500).json({ message: "Database error" });
                res.json({ expenses: rows });
            }
        );
    });
});

// ADD EXPENSE
app.post("/api/expenses", (req, res) => {
    const { email, description, amount, category, date } = req.body;
    if (!description || !(amount > 0) || !category) {
        return res.status(400).json({ message: "Description, amount and category are required" });
    }
    withUser(email, res, (userId) => {
        const d = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);
        db.query(
            "INSERT INTO expenses (user_id, description, amount, category, expense_date) VALUES (?, ?, ?, ?, ?)", [userId, description, amount, category, d],
            (err, result) => {
                if (err) {
                    console.error("Expense insert error:", err);
                    return res.status(500).json({ message: "Could not save expense" });
                }
                res.status(201).json({ id: result.insertId });
            }
        );
    });
});

// DELETE EXPENSE
app.delete("/api/expenses/:id", (req, res) => {
    withUser(req.query.email, res, (userId) => {
        db.query("DELETE FROM expenses WHERE id = ? AND user_id = ?", [req.params.id, userId], (err) => {
            if (err) return res.status(500).json({ message: "Could not delete expense" });
            res.json({ message: "Deleted" });
        });
    });
});

// START SERVER — KEEP THIS AT THE VERY BOTTOM
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});