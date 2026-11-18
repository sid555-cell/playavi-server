const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class JsonCollection {
  constructor(name, defaultData = []) {
    this.name = name;
    this.filePath = path.join(DATA_DIR, `${name}.json`);
    this.defaultData = defaultData;
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify(this.defaultData, null, 2), "utf8");
        this.data = JSON.parse(JSON.stringify(this.defaultData));
      } else {
        const raw = fs.readFileSync(this.filePath, "utf8");
        this.data = JSON.parse(raw);
      }
    } catch (err) {
      console.error(`Error loading collection ${this.name}:`, err);
      this.data = JSON.parse(JSON.stringify(this.defaultData));
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
    } catch (err) {
      console.error(`Error saving collection ${this.name}:`, err);
    }
  }

  find(query = {}) {
    return this.data.filter((item) => {
      for (const [key, val] of Object.entries(query)) {
        if (item[key] !== val) return false;
      }
      return true;
    });
  }

  findOne(query = {}) {
    return (
      this.data.find((item) => {
        for (const [key, val] of Object.entries(query)) {
          if (item[key] !== val) return false;
        }
        return true;
      }) || null
    );
  }

  findById(id) {
    return this.data.find((item) => item.id === id || item._id === id) || null;
  }

  insert(doc) {
    const newDoc = {
      id: doc.id || doc._id || `id_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      ...doc,
    };
    if (!newDoc._id) newDoc._id = newDoc.id;
    this.data.push(newDoc);
    this._save();
    return newDoc;
  }

  update(query, updates) {
    let count = 0;
    this.data = this.data.map((item) => {
      let match = true;
      for (const [key, val] of Object.entries(query)) {
        if (item[key] !== val) {
          match = false;
          break;
        }
      }
      if (match) {
        count++;
        return { ...item, ...updates, updatedAt: new Date().toISOString() };
      }
      return item;
    });
    if (count > 0) this._save();
    return count;
  }

  updateOne(query, updates) {
    const index = this.data.findIndex((item) => {
      for (const [key, val] of Object.entries(query)) {
        if (item[key] !== val) return false;
      }
      return true;
    });
    if (index !== -1) {
      this.data[index] = {
        ...this.data[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      this._save();
      return this.data[index];
    }
    return null;
  }

  delete(query) {
    const initialLen = this.data.length;
    this.data = this.data.filter((item) => {
      for (const [key, val] of Object.entries(query)) {
        if (item[key] !== val) return true;
      }
      return false;
    });
    if (this.data.length !== initialLen) this._save();
    return initialLen - this.data.length;
  }

  count(query = {}) {
    return this.find(query).length;
  }
}

const defaultSettings = [
  {
    id: "settings",
    minBet: 10,
    maxBet: 10000,
    houseEdge: 4,
    nextCrashTarget: null,
    botEnabled: true,
    botCount: 20,
    upiId: "aviatoradmin@ybl",
    upiName: "Aviator Official Pay",
    qrImageUrl: "/assets/upi-qr.png",
    maintenance: false,
  },
];

const db = {
  users: new JsonCollection("users"),
  rounds: new JsonCollection("rounds"),
  bets: new JsonCollection("bets"),
  transactions: new JsonCollection("transactions"),
  settings: new JsonCollection("settings", defaultSettings),
};

module.exports = db;
