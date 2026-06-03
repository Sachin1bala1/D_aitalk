#!/usr/bin/env node
// Usage: node scripts/generate-license-key.js [PRO|ENT] [days]
// Example: node scripts/generate-license-key.js PRO 365

import { createHmac } from "crypto";

const SECRET = process.env.DATAIQ_LICENSE_SECRET || "dataiq-dev-secret-2026";
const tier = (process.argv[2] || "PRO").toUpperCase();
const days = parseInt(process.argv[3] || "365", 10);

if (!["PRO", "ENT"].includes(tier)) {
  console.error("Tier must be PRO or ENT");
  process.exit(1);
}

const nowDays = Math.floor(Date.now() / 86400000);
const expiryDays = nowDays + days;

const message = `${tier}-${expiryDays}`;
const hmac = createHmac("sha256", SECRET).update(message).digest("hex");
const key = `DATAIQ-${tier}-${expiryDays}-${hmac}`;

console.log(`License key (${tier}, expires in ${days} days):`);
console.log(key);
console.log();
console.log("Expires:", new Date(expiryDays * 86400000).toDateString());
