const db = require("./db");

// Indian & Global realistic bot names
const BOT_NAMES = [
  "Rahul_99", "Vikram_07", "Aman_K", "Pooja_S", "Amit_Singh",
  "CasinoKing", "Tiger99", "LuckyRider", "AviatorPro", "Deepak_V",
  "RoxxStar", "Sanjay_R", "Pawan_7", "Kabir_S", "Sunil_88",
  "Rajesh_K", "Ankit_92", "Rohan_X", "Priya_G", "Manish_007",
  "Vikas_Ch", "Karan_J", "Arjun_99", "Vijay_B", "Simran_K"
];

const BOT_AVATARS = [
  "./avatars/av-3.png", "./avatars/av-4.png", "./avatars/av-5.png",
  "./avatars/av-12.png", "./avatars/av-13.png", "./avatars/av-14.png",
  "./avatars/av-15.png", "./avatars/av-39.png", "./avatars/av-45.png"
];

class GameEngine {
  constructor(io) {
    this.io = io;
    this.gameState = "BET"; // "BET" | "PLAYING" | "GAMEEND"
    this.currentNum = 1.0;
    this.roundStartTime = Date.now();
    this.roundNumber = 1;
    this.crashTarget = 2.0;
    this.activeBets = []; // Array of { socketId, userId, userName, type, betAmount, target, cashouted, cashOut, img, bot, auto }
    this.previousHand = [];
    this.history = [];
    this.intervalId = null;

    this.initHistory();
  }

  initHistory() {
    const rounds = db.rounds.find().slice(-25).reverse();
    if (rounds.length > 0) {
      this.history = rounds.map((r) => Number(r.crashMultiplier));
      this.roundNumber = rounds.length + 1;
    } else {
      this.history = [1.25, 2.14, 1.05, 3.42, 1.88, 14.25, 1.12, 4.31, 2.05, 1.55];
      this.roundNumber = 11;
    }
  }

  calculateMultiplier(elapsedSec) {
    // Formula matching client in src/components/crash/index.tsx
    const t = 0.06 * elapsedSec;
    const t2 = 0.04 * elapsedSec;
    const mult = 1 + t + Math.pow(t, 2) - Math.pow(t2, 3) + Math.pow(t2, 4);
    return Math.max(1.0, mult);
  }

  generateCrashTarget() {
    // Check if Admin set a forced crash multiplier in settings
    const settings = db.settings.findOne({ id: "settings" });
    if (settings && settings.nextCrashTarget && Number(settings.nextCrashTarget) >= 1.0) {
      const forced = Number(settings.nextCrashTarget);
      console.log(`[GameEngine] Using ADMIN FORCED Crash Multiplier: ${forced}x`);
      db.settings.updateOne({ id: "settings" }, { nextCrashTarget: null });
      return { target: forced, forced: true };
    }

    // Provably Fair / House Edge weighted algorithm
    const houseEdge = (settings && settings.houseEdge) || 4; // default 4% house edge
    const rand = Math.random() * 100;

    let target = 1.0;
    if (rand < 8 + houseEdge) {
      // Instant crash (1.00x - 1.20x)
      target = 1.0 + Math.random() * 0.2;
    } else if (rand < 55) {
      // Low multiplier (1.21x - 2.20x)
      target = 1.21 + Math.random() * 0.99;
    } else if (rand < 82) {
      // Medium multiplier (2.21x - 4.50x)
      target = 2.21 + Math.random() * 2.29;
    } else if (rand < 94) {
      // High multiplier (4.51x - 12.00x)
      target = 4.51 + Math.random() * 7.49;
    } else if (rand < 98.5) {
      // Mega multiplier (12.01x - 40.00x)
      target = 12.01 + Math.random() * 27.99;
    } else {
      // Super jackpot (40.01x - 150.00x)
      target = 40.01 + Math.random() * 110.0;
    }

    return { target: Number(target.toFixed(2)), forced: false };
  }

  generateBots() {
    const settings = db.settings.findOne({ id: "settings" });
    if (settings && settings.botEnabled === false) return [];

    const botCount = (settings && settings.botCount) || 18;
    const shuffled = [...BOT_NAMES].sort(() => 0.5 - Math.random());
    const count = Math.min(botCount, Math.floor(Math.random() * 8) + 12);
    const bots = [];

    const betDenominations = [20, 50, 100, 200, 500, 800, 1000];

    for (let i = 0; i < count; i++) {
      const name = shuffled[i] || `User_${Math.floor(Math.random() * 900 + 100)}`;
      const avatar = BOT_AVATARS[Math.floor(Math.random() * BOT_AVATARS.length)];
      const betAmount = betDenominations[Math.floor(Math.random() * betDenominations.length)];

      // Bot cashout target: some conservative, some greedy
      let botTarget;
      const r = Math.random();
      if (r < 0.4) botTarget = 1.2 + Math.random() * 0.6; // 1.20 - 1.80
      else if (r < 0.75) botTarget = 1.8 + Math.random() * 1.5; // 1.80 - 3.30
      else if (r < 0.92) botTarget = 3.3 + Math.random() * 4.0; // 3.30 - 7.30
      else botTarget = 7.3 + Math.random() * 15.0; // 7.30 - 22.30

      bots.push({
        socketId: null,
        userId: `bot_${i}`,
        name,
        img: avatar,
        betAmount,
        target: Number(botTarget.toFixed(2)),
        cashOut: 0,
        cashouted: false,
        bot: false, // Set to false so client's filterBots shows them in All Bets!
        auto: false,
        type: "f",
      });
    }

    return bots;
  }

  start() {
    console.log("[GameEngine] Starting Aviator game loop...");
    this.startBettingPhase();
  }

  startBettingPhase() {
    this.gameState = "BET";
    this.currentNum = 1.0;
    this.roundStartTime = Date.now();

    // Reset round bets and add fresh bots
    const bots = this.generateBots();
    this.activeBets = [...bots];

    console.log(`[GameEngine] Round #${this.roundNumber} - BETTING Phase started (5 seconds)`);

    // Broadcast Game State
    this.io.emit("gameState", {
      GameState: "BET",
      time: this.roundStartTime,
      currentNum: 1.0,
      currentSecondNum: 0,
    });

    // Broadcast current betted users
    this.broadcastBettedUsers();

    // 5 seconds betting window
    setTimeout(() => {
      this.startPlayingPhase();
    }, 5000);
  }

  startPlayingPhase() {
    this.gameState = "PLAYING";
    const crashInfo = this.generateCrashTarget();
    this.crashTarget = crashInfo.target;
    this.isCrashForced = crashInfo.forced;
    this.flightStartTime = Date.now();

    console.log(`[GameEngine] Round #${this.roundNumber} - PLAYING Phase (Plane Flying, target: ${this.crashTarget}x)`);

    this.io.emit("gameState", {
      GameState: "PLAYING",
      time: this.flightStartTime,
      currentNum: 1.0,
      currentSecondNum: 0,
    });

    // Ticking loop every 50ms
    this.intervalId = setInterval(() => {
      const elapsedSec = (Date.now() - this.flightStartTime) / 1000;
      this.currentNum = Number(this.calculateMultiplier(elapsedSec).toFixed(2));

      // Handle Bot auto cashouts
      let stateChanged = false;
      for (const bet of this.activeBets) {
        if (!bet.cashouted && bet.target <= this.currentNum && bet.target <= this.crashTarget) {
          bet.cashouted = true;
          bet.cashOut = Number((bet.betAmount * bet.target).toFixed(2));
          stateChanged = true;

          // If real user with auto cashout
          if (bet.socketId && !bet.bot) {
            this.handleUserCashout(bet, bet.target);
          }
        }
      }

      if (stateChanged) {
        this.broadcastBettedUsers();
      }

      // Check for Crash
      if (this.currentNum >= this.crashTarget) {
        clearInterval(this.intervalId);
        this.startCrashPhase();
      }
    }, 50);
  }

  startCrashPhase() {
    this.gameState = "GAMEEND";
    this.currentNum = this.crashTarget;

    console.log(`[GameEngine] Round #${this.roundNumber} - FLEW AWAY! Crashed at ${this.crashTarget}x`);

    this.io.emit("gameState", {
      GameState: "GAMEEND",
      time: Date.now(),
      currentNum: this.crashTarget,
      currentSecondNum: 0,
    });

    // Settle all bets
    this.settleRound();

    // 3 seconds pause before next round
    setTimeout(() => {
      this.roundNumber++;
      this.startBettingPhase();
    }, 3000);
  }

  settleRound() {
    // Record round in DB
    let totalBetAmount = 0;
    let totalPayout = 0;

    const realUserBets = this.activeBets.filter((b) => b.userId && !b.userId.startsWith("bot_"));

    realUserBets.forEach((bet) => {
      totalBetAmount += bet.betAmount;
      if (bet.cashouted) {
        totalPayout += bet.cashOut;
      }
    });

    const platformProfit = totalBetAmount - totalPayout;

    db.rounds.insert({
      id: `round_${this.roundNumber}_${Date.now()}`,
      roundNumber: this.roundNumber,
      crashMultiplier: this.crashTarget,
      forced: !!this.isCrashForced,
      totalBets: this.activeBets.length,
      totalBetAmount,
      totalPayout,
      platformProfit,
      startTime: this.flightStartTime,
      endTime: Date.now(),
    });

    // Update history (newest first)
    this.history.unshift(this.crashTarget);
    if (this.history.length > 50) this.history.pop();
    this.io.emit("history", this.history);

    // Save previous hand
    this.previousHand = [...this.activeBets];
    this.io.emit("previousHand", this.previousHand);

    // Send finishGame event to all connected sockets
    const sockets = this.io.sockets.sockets;
    sockets.forEach((sock) => {
      if (sock.user) {
        const userInDb = db.users.findById(sock.user.id);
        const userBets = this.activeBets.filter((b) => b.userId === sock.user.id);
        const betF = userBets.find((b) => b.type === "f");
        const betS = userBets.find((b) => b.type === "s");

        sock.emit("finishGame", {
          balance: userInDb ? userInDb.balance : 0,
          userType: true,
          userName: sock.user.userName,
          f: {
            auto: betF?.auto || false,
            betted: false,
            cashouted: betF?.cashouted || false,
            betAmount: betF?.betAmount || 20,
            cashAmount: betF?.cashOut || 0,
            target: betF?.target || 2,
          },
          s: {
            auto: betS?.auto || false,
            betted: false,
            cashouted: betS?.cashouted || false,
            betAmount: betS?.betAmount || 20,
            cashAmount: betS?.cashOut || 0,
            target: betS?.target || 2,
          },
        });
      }
    });
  }

  broadcastBettedUsers() {
    const formatted = this.activeBets.map((b) => ({
      name: b.name,
      betAmount: b.betAmount,
      cashOut: b.cashOut,
      cashouted: b.cashouted,
      target: b.target,
      img: b.img || "./avatars/av-5.png",
      bot: false,
    }));
    this.io.emit("bettedUserInfo", formatted);
  }

  placeBet(socket, data) {
    // data: { betAmount, target, type: 'f'|'s', auto }
    if (this.gameState !== "BET") {
      socket.emit("error", { index: data.type, message: "Bets are only allowed during the betting phase" });
      return;
    }

    if (!socket.user) {
      socket.emit("error", { index: data.type, message: "User not authenticated" });
      return;
    }

    const user = db.users.findById(socket.user.id);
    if (!user) {
      socket.emit("error", { index: data.type, message: "User not found" });
      return;
    }

    const betAmount = Number(data.betAmount);
    if (isNaN(betAmount) || betAmount <= 0) {
      socket.emit("error", { index: data.type, message: "Invalid bet amount" });
      return;
    }

    if (user.balance < betAmount) {
      socket.emit("error", { index: data.type, message: "Your balance is not enough" });
      return;
    }

    // Check if already placed bet of this type in this round
    const existing = this.activeBets.find((b) => b.userId === user.id && b.type === data.type);
    if (existing) {
      socket.emit("error", { index: data.type, message: `Bet already placed on panel ${data.type.toUpperCase()}` });
      return;
    }

    // Deduct balance
    const newBalance = Number((user.balance - betAmount).toFixed(2));
    db.users.updateOne({ id: user.id }, { balance: newBalance });
    user.balance = newBalance;

    // Record bet
    const newBet = {
      socketId: socket.id,
      userId: user.id,
      name: user.userName,
      img: "./avatars/av-12.png",
      betAmount,
      target: Number(data.target) || 2.0,
      cashOut: 0,
      cashouted: false,
      bot: false,
      auto: !!data.auto,
      type: data.type,
    };
    this.activeBets.push(newBet);

    // Save to bets collection
    db.bets.insert({
      roundNumber: this.roundNumber,
      userId: user.id,
      userName: user.userName,
      type: data.type,
      betAmount,
      target: Number(data.target) || 2.0,
      status: "betted",
      date: Date.now(),
    });

    // Notify user socket
    socket.emit("myBetState", {
      f: { betted: this.activeBets.some((b) => b.userId === user.id && b.type === "f") },
      s: { betted: this.activeBets.some((b) => b.userId === user.id && b.type === "s") },
    });

    socket.emit("myInfo", {
      balance: newBalance,
      userType: true,
      userName: user.userName,
    });

    // Broadcast updated betted users
    this.broadcastBettedUsers();
  }

  cashOut(socket, data) {
    // data: { type: 'f'|'s', endTarget: number }
    if (this.gameState !== "PLAYING") {
      socket.emit("error", { index: data.type, message: "Game is not currently flying" });
      return;
    }

    if (!socket.user) {
      socket.emit("error", { index: data.type, message: "Not authenticated" });
      return;
    }

    const bet = this.activeBets.find((b) => b.userId === socket.user.id && b.type === data.type && !b.cashouted);
    if (!bet) {
      socket.emit("error", { index: data.type, message: "No active bet found to cash out" });
      return;
    }

    const mult = Math.min(this.currentNum, this.crashTarget);
    this.handleUserCashout(bet, mult, socket);
  }

  handleUserCashout(bet, multiplier, socketInstance = null) {
    if (bet.cashouted) return;

    const winAmount = Number((bet.betAmount * multiplier).toFixed(2));
    bet.cashouted = true;
    bet.cashOut = winAmount;
    bet.target = multiplier;

    const user = db.users.findById(bet.userId);
    if (user) {
      const updatedBalance = Number((user.balance + winAmount).toFixed(2));
      db.users.updateOne({ id: user.id }, { balance: updatedBalance });

      db.bets.updateOne(
        { userId: user.id, roundNumber: this.roundNumber, type: bet.type },
        { status: "cashed_out", cashOut: winAmount, cashoutMultiplier: multiplier }
      );

      // Record transaction
      db.transactions.insert({
        userId: user.id,
        userName: user.userName,
        type: "bet_win",
        amount: winAmount,
        status: "approved",
        note: `Aviator win at ${multiplier.toFixed(2)}x`,
        createdAt: new Date().toISOString(),
      });

      const socket = socketInstance || this.io.sockets.sockets.get(bet.socketId);
      if (socket) {
        socket.emit("myInfo", {
          balance: updatedBalance,
          userType: true,
          userName: user.userName,
        });

        socket.emit("myBetState", {
          f: { betted: this.activeBets.some((b) => b.userId === user.id && b.type === "f" && !b.cashouted) },
          s: { betted: this.activeBets.some((b) => b.userId === user.id && b.type === "s" && !b.cashouted) },
        });

        socket.emit("success", `Cashed out ₹${winAmount.toFixed(2)} at ${multiplier.toFixed(2)}x! 🎉`);
      }
    }

    this.broadcastBettedUsers();
  }
}

module.exports = GameEngine;
