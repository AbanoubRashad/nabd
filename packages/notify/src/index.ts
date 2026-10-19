/**
 * Notification providers. Ingest and the API depend only on the `Provider` interface; which providers are
 * live is decided by environment variables, and the console provider stands in for all of them in
 * development and in the public demo (the demo contact has no real phone number).
 */

export type Channel = 'whatsapp' | 'email' | 'console';
export type Locale = 'en' | 'ar';

export interface AlertMessage {
  severity: 'warning' | 'critical';
  reason: 'opened' | 'escalation' | 'resolved' | 'test';
  /** "Medicine fridge, Heliopolis" */
  subject: string;
  /** "8.3 °C", already formatted with its unit. */
  value: string;
  /** "It has been above 8.0 °C for 5 minutes. Door: closed." */
  detail: string;
  locale: Locale;
  alertId: string | null;
}

export interface SendResult {
  providerMessageId: string | null;
}

export interface Provider {
  readonly channel: Channel;
  send(to: string, message: AlertMessage): Promise<SendResult>;
}

// ---- text -----------------------------------------------------------------------------------------------

const SEVERITY = {
  en: { warning: 'Warning', critical: 'Critical' },
  ar: { warning: 'تحذير', critical: 'حرج' },
} as const;

/**
 * The approved WhatsApp template `nabd_alert` has the body below with four parameters. Email and the
 * console use the same words, so every channel says the same thing.
 *
 * en: "Nabd alert · {{1}}\n{{2}} is at {{3}}. {{4}}\nReply 1 to acknowledge, 2 to mute for 1 hour."
 * ar: "تنبيه نبض · {{1}}\n{{2}} عند {{3}}. {{4}}\nرد بـ 1 للتأكيد أو 2 للكتم لمدة ساعة."
 */
export function templateParameters(m: AlertMessage): [string, string, string, string] {
  const severity = SEVERITY[m.locale][m.severity];
  const label = m.reason === 'resolved' ? (m.locale === 'ar' ? 'تم الحل' : 'Resolved') : severity;
  return [m.reason === 'test' ? `${label} (test)` : label, m.subject, m.value, m.detail];
}

export function renderText(m: AlertMessage): string {
  const [label, subject, value, detail] = templateParameters(m);
  if (m.locale === 'ar') {
    const tail = m.reason === 'resolved' ? 'لا حاجة لأي إجراء.' : 'رد بـ 1 للتأكيد أو 2 للكتم لمدة ساعة.';
    return `تنبيه نبض · ${label}\n${subject} عند ${value}. ${detail}\n${tail}`;
  }
  const tail =
    m.reason === 'resolved' ? 'No action needed.' : 'Reply 1 to acknowledge, 2 to mute for 1 hour.';
  return `Nabd alert · ${label}\n${subject} is at ${value}. ${detail}\n${tail}`;
}

// ---- providers ------------------------------------------------------------------------------------------

/** Development and demo: writes the message to the log instead of sending it. */
export class ConsoleProvider implements Provider {
  readonly channel = 'console' as const;
  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}
  async send(to: string, message: AlertMessage): Promise<SendResult> {
    this.log(`[notify → ${to}]\n${renderText(message)}`);
    return { providerMessageId: `console-${Date.now()}` };
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function postJson(
  fetchImpl: Fetch,
  url: string,
  token: string,
  body: unknown,
  timeoutMs = 8000,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // 429 and 5xx are worth retrying; other 4xx mean the request itself is wrong.
    throw new ProviderError(
      `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`,
      res.status === 429 || res.status >= 500,
    );
  }
  return json;
}

export interface WhatsAppOptions {
  token: string;
  phoneNumberId: string;
  apiVersion?: string;
  template?: string;
  fetchImpl?: Fetch;
}

/** WhatsApp Cloud API, sending the approved `nabd_alert` template in the contact's language. */
export class WhatsAppProvider implements Provider {
  readonly channel = 'whatsapp' as const;
  constructor(private readonly o: WhatsAppOptions) {}

  async send(to: string, message: AlertMessage): Promise<SendResult> {
    const url = `https://graph.facebook.com/${this.o.apiVersion ?? 'v23.0'}/${this.o.phoneNumberId}/messages`;
    const json = await postJson(this.o.fetchImpl ?? fetch, url, this.o.token, {
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: this.o.template ?? 'nabd_alert',
        language: { code: message.locale === 'ar' ? 'ar' : 'en' },
        components: [
          { type: 'body', parameters: templateParameters(message).map((text) => ({ type: 'text', text })) },
        ],
      },
    });
    const messages = json.messages as { id?: string }[] | undefined;
    return { providerMessageId: messages?.[0]?.id ?? null };
  }
}

export interface ResendOptions {
  apiKey: string;
  from: string;
  fetchImpl?: Fetch;
}

export class ResendProvider implements Provider {
  readonly channel = 'email' as const;
  constructor(private readonly o: ResendOptions) {}

  async send(to: string, message: AlertMessage): Promise<SendResult> {
    const [label, subject, value] = templateParameters(message);
    const json = await postJson(this.o.fetchImpl ?? fetch, 'https://api.resend.com/emails', this.o.apiKey, {
      from: this.o.from,
      to: [to],
      subject: `Nabd ${label}: ${subject} at ${value}`,
      text: renderText(message),
    });
    return { providerMessageId: typeof json.id === 'string' ? json.id : null };
  }
}

// ---- retries --------------------------------------------------------------------------------------------

export interface Attempt {
  attempt: number;
  ok: boolean;
  providerMessageId: string | null;
  error: string | null;
}

/**
 * Sends with up to `attempts` tries and exponential backoff (1 s, 2 s, 4 s …) on retryable errors. Every
 * try is reported through `onAttempt`, so each one can be logged in the `notifications` table. Never throws.
 */
export async function sendWithRetry(
  provider: Provider,
  to: string,
  message: AlertMessage,
  opts: { attempts?: number; baseDelayMs?: number; onAttempt?: (a: Attempt) => void | Promise<void> } = {},
): Promise<Attempt> {
  const attempts = opts.attempts ?? 3;
  let last: Attempt = { attempt: 0, ok: false, providerMessageId: null, error: 'not attempted' };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { providerMessageId } = await provider.send(to, message);
      last = { attempt, ok: true, providerMessageId, error: null };
      await opts.onAttempt?.(last);
      return last;
    } catch (error) {
      const retryable = !(error instanceof ProviderError) || error.retryable;
      last = {
        attempt,
        ok: false,
        providerMessageId: null,
        error: error instanceof Error ? error.message : String(error),
      };
      await opts.onAttempt?.(last);
      if (!retryable) return last;
      if (attempt < attempts)
        await new Promise((r) => setTimeout(r, (opts.baseDelayMs ?? 1000) * 2 ** (attempt - 1)));
    }
  }
  return last;
}

// ---- configuration --------------------------------------------------------------------------------------

export interface Providers {
  whatsapp: Provider;
  email: Provider;
}

/**
 * Real providers when their credentials are set, otherwise the console. In the demo both stay on the
 * console, so no message ever leaves the server.
 */
export function providersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  log?: (line: string) => void,
): Providers {
  const console_ = new ConsoleProvider(log);
  const whatsapp =
    env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
      ? new WhatsAppProvider({
          token: env.WHATSAPP_TOKEN,
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          apiVersion: env.WHATSAPP_API_VERSION || undefined,
        })
      : console_;
  const email =
    env.RESEND_API_KEY && env.ALERT_EMAIL_FROM
      ? new ResendProvider({ apiKey: env.RESEND_API_KEY, from: env.ALERT_EMAIL_FROM })
      : console_;
  return { whatsapp, email };
}
