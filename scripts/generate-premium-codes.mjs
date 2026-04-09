#!/usr/bin/env node
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  return match.slice(prefix.length).trim();
};

const plan = getArg("plan", "monthly").toLowerCase();
if (plan !== "monthly" && plan !== "yearly") {
  console.error("Invalid --plan. Use monthly or yearly.");
  process.exit(1);
}

const count = Number(getArg("count", "20"));
if (!Number.isInteger(count) || count < 1 || count > 5000) {
  console.error("Invalid --count. Use an integer between 1 and 5000.");
  process.exit(1);
}

const defaultDays = plan === "yearly" ? 365 : 30;
const durationDays = Number(getArg("days", String(defaultDays)));
if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
  console.error("Invalid --days. Use an integer between 1 and 3650.");
  process.exit(1);
}

const maxRedemptions = Number(getArg("max-redemptions", "1"));
if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000) {
  console.error("Invalid --max-redemptions. Use an integer between 1 and 100000.");
  process.exit(1);
}

const defaultPrefix = plan === "yearly" ? "YR" : "MTH";
const prefix = (getArg("prefix", defaultPrefix) || defaultPrefix).toUpperCase().replace(/[^A-Z0-9]/g, "");
if (!prefix) {
  console.error("Invalid --prefix.");
  process.exit(1);
}

const expiresAt = getArg("expires-at", "");
if (expiresAt) {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    console.error("Invalid --expires-at. Use ISO date, e.g. 2026-12-31T23:59:59Z");
    process.exit(1);
  }
}

const codeBody = () => randomBytes(5).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

const seen = new Set();
const codes = [];
while (codes.length < count) {
  const code = `${prefix}-${codeBody()}-${codeBody()}`;
  if (seen.has(code)) continue;
  seen.add(code);
  codes.push(code);
}

const escapeSql = (value) => value.replace(/'/g, "''");
const expiresSql = expiresAt ? `'${escapeSql(expiresAt)}'::timestamptz` : "null";

const values = codes
  .map(
    (code) =>
      `('${escapeSql(code)}', '${plan}', ${durationDays}, ${maxRedemptions}, true, ${expiresSql})`,
  )
  .join(",\n  ");

const sql = `insert into public.premium_codes (code, plan, duration_days, max_redemptions, active, expires_at)\nvalues\n  ${values};`;

console.log("-- Generated premium codes");
console.log(`-- plan=${plan} count=${count} duration_days=${durationDays} max_redemptions=${maxRedemptions}`);
if (expiresAt) console.log(`-- expires_at=${expiresAt}`);
console.log(sql);
console.log("");
console.log("-- Raw codes (one per line)");
for (const code of codes) {
  console.log(code);
}
