const nodemailer = require("nodemailer");

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    throw new Error("Email service is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD.");
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE).toLowerCase() === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({
    from,
    to,
    subject: "Reset your MamaGuard password",
    text: `Hello ${name || "there"},\n\nUse this link to set a new MamaGuard password:\n${resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Hello ${name || "there"},</p><p>Use the button below to set a new MamaGuard password.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#2d9d78;color:#fff;text-decoration:none;border-radius:6px">Set a new password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>`,
  });
}

module.exports = { sendPasswordResetEmail };
