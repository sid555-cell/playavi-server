const bcrypt = require("bcryptjs");
const db = require("./db");

async function seed() {
  console.log("Seeding initial users and settings...");

  // Check Admin
  let admin = db.users.findOne({ role: "admin" });
  if (!admin) {
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync("admin123", salt);
    admin = db.users.insert({
      id: "admin_1",
      userName: "admin",
      phone: "9999999999",
      password: hashedPassword,
      balance: 100000,
      role: "admin",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    console.log("Admin account created: admin / admin123");
  } else {
    console.log("Admin account already exists:", admin.userName);
  }

  // Check Demo Player
  let demoUser = db.users.findOne({ userName: "player1" });
  if (!demoUser) {
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync("123456", salt);
    demoUser = db.users.insert({
      id: "user_demo_1",
      userName: "player1",
      phone: "9876543210",
      password: hashedPassword,
      balance: 2500,
      role: "user",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    console.log("Demo player account created: player1 / 123456 (Balance: 2500 INR)");
  }

  // Ensure default round history exists
  if (db.rounds.count() === 0) {
    const sampleMultipliers = [1.25, 2.14, 1.05, 3.42, 1.88, 14.25, 1.12, 4.31, 1.01, 7.62, 2.05, 1.55];
    sampleMultipliers.forEach((mult, i) => {
      db.rounds.insert({
        id: `round_seed_${i + 1}`,
        roundNumber: i + 1,
        crashMultiplier: mult,
        forced: false,
        totalBets: 12,
        totalBetAmount: 2400,
        totalPayout: 2100,
        platformProfit: 300,
        startTime: Date.now() - (12 - i) * 30000,
        endTime: Date.now() - (12 - i) * 30000 + 15000,
      });
    });
    console.log("Initialized sample round history.");
  }

  console.log("Seeding complete!");
}

if (require.main === module) {
  seed();
}

module.exports = seed;
