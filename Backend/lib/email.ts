// lib/email.ts — Production Email Service
// Uses Nodemailer with SMTP (works with: Gmail, Resend, Mailgun, SendGrid, Brevo)
// For Resend: SMTP_HOST=smtp.resend.com, SMTP_PORT=465, SMTP_SECURE=true

import nodemailer from 'nodemailer';

// ─── Transporter (Singleton) ──────────────────────────────────────────────────

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST) {
    // Dev: log emails to console instead of sending
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[email] SMTP not configured — using ethereal preview mode');
    } else {
      throw new Error('FATAL: SMTP_HOST not set in production');
    }
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 5,
    rateDelta: 1000,
    rateLimit: 5,
  });

  return transporter;
}

const FROM = `"Melody AI" <${process.env.SMTP_FROM || 'noreply@melody-ai.com'}>`;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || 'https://melody-ai.netlify.app';

// ─── Base HTML Template ───────────────────────────────────────────────────────

function baseTemplate(title: string, body: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#050816;font-family:Arial,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#050816;padding:40px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <!-- Header -->
        <tr>
          <td style="padding:0 0 24px;text-align:center">
            <span style="font-size:26px;font-weight:900;background:linear-gradient(90deg,#a5b4fc,#67e8f9);-webkit-background-clip:text;color:transparent">
              🎵 Melody AI
            </span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:#0b1023;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:36px">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 0;text-align:center;color:#475569;font-size:12px">
            © ${new Date().getFullYear()} Melody AI · 
            <a href="${APP_URL}/settings" style="color:#64748b">إلغاء الاشتراك</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(text: string, url: string): string {
  return `<div style="text-align:center;margin:28px 0">
    <a href="${url}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">
      ${text}
    </a>
  </div>
  <p style="text-align:center;color:#64748b;font-size:12px;margin-top:8px">
    أو انسخ الرابط: <br/>
    <a href="${url}" style="color:#818cf8;word-break:break-all">${url}</a>
  </p>`;
}

// ─── Email Senders ────────────────────────────────────────────────────────────

async function send(to: string, subject: string, html: string): Promise<void> {
  if (process.env.NODE_ENV === 'development' && !process.env.SMTP_HOST) {
    console.log(`\n[email:dev] TO: ${to}\nSUBJECT: ${subject}\n---\n${html.replace(/<[^>]+>/g, '')}\n---\n`);
    return;
  }

  try {
    const info = await getTransporter().sendMail({ from: FROM, to, subject, html });
    console.log(`[email] sent to ${to}: ${info.messageId}`);
  } catch (err) {
    console.error(`[email] failed to send to ${to}:`, err);
    throw err;
  }
}

/** Verify email on registration */
export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const url = `${APP_URL}/verify-email?token=${token}`;
  await send(
    email,
    '✅ تفعيل حسابك في Melody AI',
    baseTemplate('تفعيل الحساب', `
      <h2 style="margin:0 0 12px;color:#f1f5f9">مرحباً! 👋</h2>
      <p style="color:#94a3b8;line-height:1.7">
        شكراً لتسجيلك في Melody AI. اضغط على الزر أدناه لتفعيل بريدك الإلكتروني والبدء بإنشاء موسيقاك.
      </p>
      ${ctaButton('تفعيل الحساب ✅', url)}
      <p style="color:#64748b;font-size:13px;margin-top:20px">
        ⏰ الرابط صالح لمدة 24 ساعة. إذا لم تسجّل في Melody AI، تجاهل هذا البريد.
      </p>
    `)
  );
}

/** Welcome email after verification */
export async function sendWelcomeEmail(email: string, name: string): Promise<void> {
  await send(
    email,
    '🎵 مرحباً بك في Melody AI!',
    baseTemplate('مرحباً بك', `
      <h2 style="margin:0 0 12px;color:#f1f5f9">مرحباً ${name}! 🎉</h2>
      <p style="color:#94a3b8;line-height:1.7">
        حسابك جاهز. لديك <strong style="color:#a5b4fc">100 Credit مجاني</strong> للبدء بإنشاء موسيقاك الأولى.
      </p>
      <div style="background:#0f172a;border-radius:10px;padding:20px;margin:20px 0">
        <p style="margin:0 0 8px;font-weight:700;color:#e2e8f0">🚀 ابدأ الآن:</p>
        <ul style="margin:0;padding:0 20px;color:#94a3b8;line-height:2">
          <li>اختر النوع الموسيقي والمزاج</li>
          <li>اكتب فكرة أو كلمات الأغنية</li>
          <li>اضغط Generate وانتظر 60 ثانية</li>
        </ul>
      </div>
      ${ctaButton('🎵 إنشاء أغنيتي الأولى', `${APP_URL}/studio`)}
    `)
  );
}

/** Password reset email */
export async function sendResetPasswordEmail(email: string, resetUrl: string): Promise<void> {
  await send(
    email,
    '🔐 إعادة تعيين كلمة المرور — Melody AI',
    baseTemplate('إعادة تعيين كلمة المرور', `
      <h2 style="margin:0 0 12px;color:#f1f5f9">إعادة تعيين كلمة المرور</h2>
      <p style="color:#94a3b8;line-height:1.7">
        تلقينا طلباً لإعادة تعيين كلمة مرور حسابك. اضغط على الزر أدناه لإنشاء كلمة مرور جديدة.
      </p>
      ${ctaButton('🔐 إعادة تعيين كلمة المرور', resetUrl)}
      <p style="color:#64748b;font-size:13px;margin-top:20px">
        ⏰ الرابط صالح لمدة ساعة واحدة فقط.<br/>
        إذا لم تطلب هذا، تجاهل البريد — كلمة مرورك لن تتغير.
      </p>
    `)
  );
}

/** Alias for backward compatibility */
export const sendPasswordResetEmail = sendResetPasswordEmail;

/** Low credits warning */
export async function sendLowCreditsEmail(email: string, name: string, balance: number): Promise<void> {
  await send(
    email,
    '⚠️ رصيدك منخفض في Melody AI',
    baseTemplate('رصيد منخفض', `
      <h2 style="margin:0 0 12px;color:#f1f5f9">رصيدك منخفض ⚠️</h2>
      <p style="color:#94a3b8;line-height:1.7">
        مرحباً ${name}، تبقى لديك <strong style="color:#f59e0b">${balance} Credits</strong> فقط.
        أضف المزيد للاستمرار في توليد الموسيقى.
      </p>
      ${ctaButton('💎 شراء Credits', `${APP_URL}/credits`)}
    `)
  );
}
