import { LOGIN_ID, LOGIN_PASSWORD, validateCredentials } from "./auth";

function assert(cond: unknown, label: string) {
  if (!cond) throw new Error(label);
}

assert(validateCredentials(LOGIN_ID, LOGIN_PASSWORD), "admin credentials succeed");
assert(validateCredentials(` ${LOGIN_ID} `, LOGIN_PASSWORD), "ID trims whitespace");
assert(!validateCredentials("admin@ecompricing", LOGIN_PASSWORD), "old ID fails");
assert(!validateCredentials(LOGIN_ID, "admin@12"), "wrong password fails");
assert(!validateCredentials("", ""), "empty credentials fail");

console.log("auth.test.ts — all assertions passed");
