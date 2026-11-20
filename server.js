const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const db = require("./db");
const GameEngine = require("./gameEngine");
const seedAdmin = require("./seedAdmin");

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || "aviator_super_secret_jwt_key_2026";
const PORT = process.env.PORT || 5050;

// Enable CORS & allow iframe embedding in PWA
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.removeHeader("X-Frame-Options");
  next();
});
app.use(express.json());

// Health check endpoint for Render/Cloud monitoring
app.get("/health", (req, res) => res.json({ status: "ok", app: "PlayAvi Aviator Server" }));

// GZIP & MIME type headers for Unity WebGL files
app.use((req, res, next) => {
  if (req.url.endsWith(".unityweb")) {
    res.setHeader("Content-Encoding", "gzip");
    if (req.url.endsWith(".wasm.unityweb")) {
      res.setHeader("Content-Type", "application/wasm");
    } else if (req.url.endsWith(".data.unityweb")) {
      res.setHeader("Content-Type", "application/octet-stream");
    } else if (req.url.endsWith(".framework.js.unityweb")) {
      res.setHeader("Content-Type", "application/javascript");
    }
  }
  next();
});

// Explicit HTML route handlers for /portal, /admin and root /
const fs = require("fs");

app.get(["/portal", "/portal/"], (req, res) => {
  const portalPath = path.join(__dirname, "public", "portal", "index.html");
  if (fs.existsSync(portalPath)) {
    return res.sendFile(portalPath);
  }
  const files = fs.existsSync(__dirname) ? fs.readdirSync(__dirname).join(", ") : "none";
  res.status(404).send(`<h3>PlayAvi Portal Not Found</h3><p>Expected at: ${portalPath}</p><p>Existing files: ${files}</p>`);
});

app.get(["/admin", "/admin/"], (req, res) => {
  const adminPath = path.join(__dirname, "public", "admin", "index.html");
  if (fs.existsSync(adminPath)) {
    return res.sendFile(adminPath);
  }
  const files = fs.existsSync(__dirname) ? fs.readdirSync(__dirname).join(", ") : "none";
  res.status(404).send(`<h3>PlayAvi Admin Not Found</h3><p>Expected at: ${adminPath}</p><p>Existing files: ${files}</p>`);
});

app.get("/", (req, res) => {
  res.redirect("/portal");
});

// Serve Admin Panel and Portal static assets
app.use("/admin", express.static(path.join(__dirname, "public", "admin")));
app.use("/portal", express.static(path.join(__dirname, "public", "portal")));
app.use(express.static(path.join(__dirname, "public")));

// Serve Unity WebGL and Avatars (from local public or parent public)
const unityPublicPath = fs.existsSync(path.join(__dirname, "public", "unity"))
  ? path.join(__dirname, "public")
  : path.join(__dirname, "..", "public");
app.use("/unity", express.static(path.join(unityPublicPath, "unity")));
app.use("/avatars", express.static(path.join(unityPublicPath, "avatars")));

// Setup Socket.IO
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Initialize Game Engine
const engine = new GameEngine(io);

// Middleware: Authenticate JWT Token for REST APIs
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ status: false, message: "Authorization token required" });

  const token = authHeader.replace("Bearer ", "");
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
}

// Middleware: Admin Only
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ status: false, message: "Access denied: Admin role required" });
    }
    next();
  });
}

// ==========================================
// USER AUTH & WALLET APIs
// ==========================================

// Register
app.post("/api/register", (req, res) => {
  const { userName, phone, password } = req.body;
  if (!userName || !password) {
    return res.status(400).json({ status: false, message: "Username and password are required" });
  }

  const existing = db.users.findOne({ userName });
  if (existing) {
    return res.status(400).json({ status: false, message: "Username already taken" });
  }

  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync(password, salt);

  const newUser = db.users.insert({
    userName,
    phone: phone || "",
    password: hashedPassword,
    balance: 50, // ₹50 Registration Bonus
    role: "user",
    status: "active",
    createdAt: new Date().toISOString(),
  });

  const token = jwt.sign(
    { id: newUser.id, userName: newUser.userName, role: newUser.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({
    status: true,
    message: "Registration successful! ₹50 bonus added.",
    token,
    user: { id: newUser.id, userName: newUser.userName, balance: newUser.balance, role: newUser.role },
  });
});

// Login
app.post("/api/login", (req, res) => {
  const { userName, password } = req.body;
  if (!userName || !password) {
    return res.status(400).json({ status: false, message: "Username and password required" });
  }

  const user = db.users.findOne({ userName });
  if (!user) {
    return res.status(400).json({ status: false, message: "User not found" });
  }

  if (user.status === "blocked") {
    return res.status(403).json({ status: false, message: "Your account is blocked. Contact support." });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(400).json({ status: false, message: "Incorrect password" });
  }

  const token = jwt.sign(
    { id: user.id, userName: user.userName, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({
    status: true,
    message: "Login successful",
    token,
    user: { id: user.id, userName: user.userName, balance: user.balance, role: user.role },
  });
});

// Me (Profile & Balance)
app.get("/api/me", authMiddleware, (req, res) => {
  const user = db.users.findById(req.user.id);
  if (!user) return res.status(404).json({ status: false, message: "User not found" });
  res.json({
    status: true,
    user: { id: user.id, userName: user.userName, phone: user.phone, balance: user.balance, role: user.role },
  });
});

// My Info - Game History (Matches React client context fetch call)
app.post("/api/my-info", (req, res) => {
  const { name } = req.body;
  const userBets = db.bets.find({ userName: name }).slice(-30).reverse();
  const formatted = userBets.map((b, idx) => ({
    _id: idx + 1,
    name: b.userName,
    betAmount: b.betAmount,
    cashoutAt: b.cashoutMultiplier || 0,
    cashouted: b.status === "cashed_out",
    date: b.date || Date.now(),
  }));
  res.json({ status: true, data: formatted });
});

// Top History endpoints for client top-history tab
function getSampleTopHistory(limit = 15) {
  const sampleWins = [
    { betAmount: 500, cashoutAt: 14.52 },
    { betAmount: 1000, cashoutAt: 8.94 },
    { betAmount: 200, cashoutAt: 25.10 },
    { betAmount: 800, cashoutAt: 6.45 },
    { betAmount: 1500, cashoutAt: 3.82 },
    { betAmount: 300, cashoutAt: 18.77 },
    { betAmount: 50, cashoutAt: 54.30 },
    { betAmount: 600, cashoutAt: 7.21 },
    { betAmount: 2000, cashoutAt: 2.50 },
    { betAmount: 100, cashoutAt: 33.15 },
  ];
  const realWins = db.bets.find({ status: "cashed_out" }).map(b => ({
    betAmount: b.betAmount,
    cashoutAt: b.cashoutMultiplier || b.target || 2.0,
  }));
  return [...realWins, ...sampleWins].sort((a, b) => (b.betAmount * b.cashoutAt) - (a.betAmount * a.cashoutAt)).slice(0, limit);
}

app.get("/api/get-day-history", (req, res) => {
  res.json({ status: true, data: getSampleTopHistory(15) });
});

app.get("/api/get-month-history", (req, res) => {
  res.json({ status: true, data: getSampleTopHistory(25) });
});

app.get("/api/get-year-history", (req, res) => {
  res.json({ status: true, data: getSampleTopHistory(35) });
});

// Deposit Request (UPI QR / UTR)
app.post("/api/deposit", authMiddleware, (req, res) => {
  const { amount, utr, upiId } = req.body;
  const amt = Number(amount);
  if (isNaN(amt) || amt < 50) {
    return res.status(400).json({ status: false, message: "Minimum deposit is ₹50" });
  }

  const tx = db.transactions.insert({
    userId: req.user.id,
    userName: req.user.userName,
    type: "deposit",
    amount: amt,
    utr: utr || "",
    upiId: upiId || "",
    status: "pending",
    note: "UPI Deposit Request",
    createdAt: new Date().toISOString(),
  });

  res.json({
    status: true,
    message: "Deposit request submitted! Admin will verify and credit your wallet shortly.",
    transaction: tx,
  });
});

// Instant Demo / Test Deposit
app.post("/api/deposit-instant", authMiddleware, (req, res) => {
  const { amount } = req.body;
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: false, message: "Invalid amount" });

  const user = db.users.findById(req.user.id);
  const updated = Number((user.balance + amt).toFixed(2));
  db.users.updateOne({ id: user.id }, { balance: updated });

  db.transactions.insert({
    userId: user.id,
    userName: user.userName,
    type: "deposit",
    amount: amt,
    status: "approved",
    note: "Instant Demo Recharge",
    createdAt: new Date().toISOString(),
  });

  res.json({ status: true, message: `Successfully added ₹${amt} to your balance!`, balance: updated });
});

// Withdrawal Request
app.post("/api/withdraw", authMiddleware, (req, res) => {
  const { amount, upiId, accountName } = req.body;
  const amt = Number(amount);
  if (isNaN(amt) || amt < 100) {
    return res.status(400).json({ status: false, message: "Minimum withdrawal is ₹100" });
  }

  const user = db.users.findById(req.user.id);
  if (user.balance < amt) {
    return res.status(400).json({ status: false, message: "Insufficient balance" });
  }

  // Deduct balance upfront
  const newBal = Number((user.balance - amt).toFixed(2));
  db.users.updateOne({ id: user.id }, { balance: newBal });

  const tx = db.transactions.insert({
    userId: user.id,
    userName: user.userName,
    type: "withdrawal",
    amount: amt,
    upiId: upiId || "",
    accountName: accountName || "",
    status: "pending",
    note: "UPI Withdrawal Request",
    createdAt: new Date().toISOString(),
  });

  res.json({
    status: true,
    message: "Withdrawal request submitted! Payout will be sent to your UPI ID.",
    balance: newBal,
    transaction: tx,
  });
});

// User Transactions
app.get("/api/transactions", authMiddleware, (req, res) => {
  const txs = db.transactions.find({ userId: req.user.id }).slice(-40).reverse();
  res.json({ status: true, data: txs });
});

// Get Settings (Limits & UPI details)
app.get("/api/settings", (req, res) => {
  const settings = db.settings.findOne({ id: "settings" });
  res.json({ status: true, settings });
});

// ==========================================
// ADMIN CONTROL APIs
// ==========================================

// Admin Login
app.post("/api/admin/login", (req, res) => {
  const { userName, password } = req.body;
  const user = db.users.findOne({ userName, role: "admin" });
  if (!user) return res.status(400).json({ status: false, message: "Admin credentials invalid" });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(400).json({ status: false, message: "Invalid admin password" });

  const token = jwt.sign(
    { id: user.id, userName: user.userName, role: "admin" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ status: true, token, user: { id: user.id, userName: user.userName, role: "admin" } });
});

// Admin Overview Stats
app.get("/api/admin/overview", adminMiddleware, (req, res) => {
  const totalUsers = db.users.count({ role: "user" });
  const allUsers = db.users.find({ role: "user" });
  const totalUserBalance = allUsers.reduce((sum, u) => sum + (u.balance || 0), 0);

  const rounds = db.rounds.find();
  const totalRounds = rounds.length;
  const totalProfit = rounds.reduce((sum, r) => sum + (r.platformProfit || 0), 0);
  const totalBetsVolume = rounds.reduce((sum, r) => sum + (r.totalBetAmount || 0), 0);

  const pendingDeposits = db.transactions.count({ type: "deposit", status: "pending" });
  const pendingWithdrawals = db.transactions.count({ type: "withdrawal", status: "pending" });

  res.json({
    status: true,
    data: {
      totalUsers,
      totalUserBalance: Number(totalUserBalance.toFixed(2)),
      totalRounds,
      totalProfit: Number(totalProfit.toFixed(2)),
      totalBetsVolume: Number(totalBetsVolume.toFixed(2)),
      pendingDeposits,
      pendingWithdrawals,
      liveState: engine.gameState,
      liveMultiplier: engine.currentNum,
      activeBetsCount: engine.activeBets.length,
    },
  });
});

// Admin Live Game Status
app.get("/api/admin/live", adminMiddleware, (req, res) => {
  const settings = db.settings.findOne({ id: "settings" });
  res.json({
    status: true,
    gameState: engine.gameState,
    currentNum: engine.currentNum,
    crashTarget: engine.crashTarget,
    roundNumber: engine.roundNumber,
    activeBets: engine.activeBets,
    nextCrashTarget: settings ? settings.nextCrashTarget : null,
  });
});

// Admin Force Next Crash Multiplier (GAME CONTROLLER)
app.post("/api/admin/set-crash", adminMiddleware, (req, res) => {
  const { target } = req.body;
  const val = target === null || target === "" ? null : Number(target);

  if (val !== null && (isNaN(val) || val < 1.0)) {
    return res.status(400).json({ status: false, message: "Crash multiplier must be at least 1.00x" });
  }

  db.settings.updateOne({ id: "settings" }, { nextCrashTarget: val });

  res.json({
    status: true,
    message: val ? `Next round will crash at exactly ${val}x!` : "Reset to automatic random crash mode.",
    nextCrashTarget: val,
  });
});

// Admin Update Settings
app.post("/api/admin/settings", adminMiddleware, (req, res) => {
  const { minBet, maxBet, houseEdge, botEnabled, botCount, upiId, upiName } = req.body;
  const updates = {};
  if (minBet !== undefined) updates.minBet = Number(minBet);
  if (maxBet !== undefined) updates.maxBet = Number(maxBet);
  if (houseEdge !== undefined) updates.houseEdge = Number(houseEdge);
  if (botEnabled !== undefined) updates.botEnabled = !!botEnabled;
  if (botCount !== undefined) updates.botCount = Number(botCount);
  if (upiId !== undefined) updates.upiId = upiId;
  if (upiName !== undefined) updates.upiName = upiName;

  db.settings.updateOne({ id: "settings" }, updates);
  res.json({ status: true, message: "Settings updated successfully", settings: db.settings.findOne({ id: "settings" }) });
});

// Admin Users List
app.get("/api/admin/users", adminMiddleware, (req, res) => {
  const users = db.users.find().map((u) => ({
    id: u.id,
    userName: u.userName,
    phone: u.phone,
    balance: u.balance,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
  }));
  res.json({ status: true, users });
});

// Admin Adjust User Balance (Credit/Debit)
app.post("/api/admin/users/:id/adjust-balance", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const { amount, action, note } = req.body; // action: 'add' | 'deduct'
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: false, message: "Invalid amount" });

  const user = db.users.findById(id);
  if (!user) return res.status(404).json({ status: false, message: "User not found" });

  let newBal = user.balance;
  if (action === "add") newBal += amt;
  else if (action === "deduct") newBal = Math.max(0, newBal - amt);

  newBal = Number(newBal.toFixed(2));
  db.users.updateOne({ id: user.id }, { balance: newBal });

  db.transactions.insert({
    userId: user.id,
    userName: user.userName,
    type: action === "add" ? "admin_credit" : "admin_debit",
    amount: amt,
    status: "approved",
    note: note || `Admin balance adjustment (${action})`,
    createdAt: new Date().toISOString(),
  });

  res.json({ status: true, message: `Balance updated to ₹${newBal}`, balance: newBal });
});

// Admin Toggle User Status (Block/Unblock)
app.post("/api/admin/users/:id/toggle-status", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const user = db.users.findById(id);
  if (!user) return res.status(404).json({ status: false, message: "User not found" });

  const newStatus = user.status === "blocked" ? "active" : "blocked";
  db.users.updateOne({ id: user.id }, { status: newStatus });
  res.json({ status: true, message: `User is now ${newStatus}`, statusName: newStatus });
});

// Admin Deposits List
app.get("/api/admin/deposits", adminMiddleware, (req, res) => {
  const deposits = db.transactions.find({ type: "deposit" }).reverse();
  res.json({ status: true, data: deposits });
});

// Admin Approve Deposit
app.post("/api/admin/deposits/:id/approve", adminMiddleware, (req, res) => {
  const tx = db.transactions.findById(req.params.id);
  if (!tx || tx.status !== "pending") return res.status(400).json({ status: false, message: "Invalid deposit request" });

  db.transactions.updateOne({ id: tx.id }, { status: "approved" });

  const user = db.users.findById(tx.userId);
  if (user) {
    const newBal = Number((user.balance + tx.amount).toFixed(2));
    db.users.updateOne({ id: user.id }, { balance: newBal });
  }

  res.json({ status: true, message: `Deposit of ₹${tx.amount} approved!` });
});

// Admin Reject Deposit
app.post("/api/admin/deposits/:id/reject", adminMiddleware, (req, res) => {
  const tx = db.transactions.findById(req.params.id);
  if (!tx || tx.status !== "pending") return res.status(400).json({ status: false, message: "Invalid deposit request" });

  db.transactions.updateOne({ id: tx.id }, { status: "rejected" });
  res.json({ status: true, message: "Deposit rejected" });
});

// Admin Withdrawals List
app.get("/api/admin/withdrawals", adminMiddleware, (req, res) => {
  const withdrawals = db.transactions.find({ type: "withdrawal" }).reverse();
  res.json({ status: true, data: withdrawals });
});

// Admin Approve Withdrawal
app.post("/api/admin/withdrawals/:id/approve", adminMiddleware, (req, res) => {
  const tx = db.transactions.findById(req.params.id);
  if (!tx || tx.status !== "pending") return res.status(400).json({ status: false, message: "Invalid withdrawal request" });

  db.transactions.updateOne({ id: tx.id }, { status: "approved" });
  res.json({ status: true, message: `Withdrawal of ₹${tx.amount} marked as PAID!` });
});

// Admin Reject Withdrawal (Refunds to user balance)
app.post("/api/admin/withdrawals/:id/reject", adminMiddleware, (req, res) => {
  const tx = db.transactions.findById(req.params.id);
  if (!tx || tx.status !== "pending") return res.status(400).json({ status: false, message: "Invalid withdrawal request" });

  db.transactions.updateOne({ id: tx.id }, { status: "rejected" });

  // Refund money to user
  const user = db.users.findById(tx.userId);
  if (user) {
    const newBal = Number((user.balance + tx.amount).toFixed(2));
    db.users.updateOne({ id: user.id }, { balance: newBal });
  }

  res.json({ status: true, message: `Withdrawal rejected and ₹${tx.amount} refunded to user balance` });
});

// Admin Past Rounds
app.get("/api/admin/rounds", adminMiddleware, (req, res) => {
  const rounds = db.rounds.find().slice(-50).reverse();
  res.json({ status: true, data: rounds });
});

// ==========================================
// SOCKET.IO REALTIME EVENT HANDLERS
// ==========================================

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Handle Enter Room
  socket.on("enterRoom", (data) => {
    let token = data && data.token;

    // Verify token or assign default player/guest
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = db.users.findById(decoded.id);
        if (user) {
          socket.user = { id: user.id, userName: user.userName, balance: user.balance, userType: true };
        }
      } catch (err) {
        console.log(`[Socket] Token verification error:`, err.message);
      }
    }

    // Default guest demo if not logged in
    if (!socket.user) {
      let guest = db.users.findOne({ userName: "player1" });
      if (!guest) {
        guest = { id: "guest_1", userName: "Guest_Player", balance: 5000, userType: true };
      }
      socket.user = { id: guest.id || guest._id, userName: guest.userName, balance: guest.balance, userType: true };
    }

    console.log(`[Socket] Room entered by ${socket.user.userName} (Balance: ₹${socket.user.balance})`);

    const settings = db.settings.findOne({ id: "settings" }) || { minBet: 10, maxBet: 10000 };

    // Send initial status to user
    socket.emit("getBetLimits", { max: settings.maxBet, min: settings.minBet });

    socket.emit("myInfo", {
      balance: socket.user.balance,
      userType: true,
      userName: socket.user.userName,
    });

    socket.emit("gameState", {
      GameState: engine.gameState,
      time: engine.roundStartTime,
      currentNum: engine.currentNum,
      currentSecondNum: 0,
    });

    socket.emit("history", engine.history);
    socket.emit("previousHand", engine.previousHand);
    socket.emit("bettedUserInfo", engine.activeBets.map((b) => ({
      name: b.name,
      betAmount: b.betAmount,
      cashOut: b.cashOut,
      cashouted: b.cashouted,
      target: b.target,
      img: b.img || "./avatars/av-5.png",
      bot: false,
    })));
  });

  // User places bet
  socket.on("playBet", (data) => {
    engine.placeBet(socket, data);
  });

  // User cashes out
  socket.on("cashOut", (data) => {
    engine.cashOut(socket, data);
  });

  socket.on("disconnect", () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// Seed Initial Admin & Start Server
seedAdmin().then(() => {
  server.listen(PORT, () => {
    console.log(`
======================================================
  ✈️  AVIATOR CRASH GAME ENGINE RUNNING SUCCESSFULLY!  
======================================================
  🚀 Server URL:       http://localhost:${PORT}
  🎮 User Game & Lobby: http://localhost:${PORT}/portal
  🛠️ Admin Panel:      http://localhost:${PORT}/admin
  📡 WebSocket:        ws://localhost:${PORT}
  
  🔑 Admin Login:      admin / admin123
  👤 Demo Player:      player1 / 123456 (Balance: ₹2500)
======================================================
    `);
    engine.start();
  });
});
