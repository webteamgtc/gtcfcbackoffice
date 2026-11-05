
import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.mailgun.org", // Mailgun SMTP host
  port: Number(process.env.SMTP_PORT || 465), // SSL/TLS port
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : true, // Use TLS
  auth: {
    user: process.env.SMTP_USER, // Mailgun SMTP username
    pass: process.env.SMTP_PASS, // Mailgun SMTP password
  },
});

export const mailOptions = {
  from: "portal@mx.gtcmail.com",
  to: "support@gtcfx.com, support@gtcup.com, marginbonus@gtcfx.com",
  bcc: "mohammad.zeeshan@gtcfx.com",
};

export const mailOptionsJobs = {
  from: "portal@mx.gtcmail.com",
  to: "careers@gtcfx.com",
  bcc: "zeeshan@gtcfx.com",
};

export const mailOptionsSupports = {
  from: "portal@mx.gtcmail.com",
  to: "support@gtcfx.com",
  bcc: "zeeshan@gtcfx.com",
};

// config/mailgun.js
import Mailgun from "mailgun.js";
import formData from "form-data";

const mg = new Mailgun(formData);

export const mailgunClient = mg.client({
  username: process.env.MAILGUN_USERNAME || "api",
  key: process.env.MAILGUN_API_KEY,
  url: process.env.MAILGUN_API_URL || "https://api.mailgun.net",
});

export const MAILGUN_DOMAIN = "mx.gtcmail.com" || "mx.gtcmail.com";

export const MAILGUN_FROM =
  "GTCFX <portal@mx.gtcmail.com>" || `GTCFX <postmaster@${MAILGUN_DOMAIN}>`;    
