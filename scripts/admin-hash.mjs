// Makes one entry for ADMIN_USERS in .env.local. Run:
//   node scripts/admin-hash.mjs anna@gtcfx.com 'a long password'
// Add the printed text to ADMIN_USERS (separate several people with commas), then restart the server.
import bcrypt from 'bcryptjs';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: node scripts/admin-hash.mjs <email> '<password>'");
  process.exit(1);
}
if (password.length < 12) {
  console.error('Please use a password of at least 12 characters.');
  process.exit(1);
}
const hash = await bcrypt.hash(password, 12);
// base64, because a raw bcrypt hash contains "$", which .env files treat as a variable
console.log(`${email.trim().toLowerCase()}:${Buffer.from(hash).toString('base64')}`);
