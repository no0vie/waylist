import nodemailer from 'nodemailer';

export interface EmailMessage { to: string; subject: string; text: string }
export interface EmailService {
  readonly available: boolean;
  send(message: EmailMessage): Promise<void>;
}

export function createEmailService(env: NodeJS.ProcessEnv): EmailService {
  const port = Number(env.SMTP_PORT || 587);
  const transport = env.SMTP_HOST && env.SMTP_FROM ? nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465,
    requireTLS: env.SMTP_REQUIRE_TLS !== 'false',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  }) : null;
  return {
    available: transport !== null,
    async send(message) {
      if (!transport) throw new Error('Email unavailable: configure SMTP_HOST and SMTP_FROM');
      try { await transport.sendMail({ from: env.SMTP_FROM, ...message }); }
      catch { throw new Error('Email delivery failed; please try again later'); }
    },
  };
}
