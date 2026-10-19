import { describe, expect, it } from 'vitest';
import {
  ConsoleProvider,
  ProviderError,
  WhatsAppProvider,
  providersFromEnv,
  renderText,
  sendWithRetry,
  type AlertMessage,
  type Attempt,
  type Provider,
} from './index.js';

const fridge: AlertMessage = {
  severity: 'warning',
  reason: 'opened',
  subject: 'Medicine fridge, Heliopolis',
  value: '8.3 °C',
  detail: 'It has been above 8.0 °C for 5 minutes. Door: closed.',
  locale: 'en',
  alertId: '42',
};

describe('message text', () => {
  it('matches the WhatsApp preview in the design', () => {
    expect(renderText(fridge)).toBe(
      'Nabd alert · Warning\nMedicine fridge, Heliopolis is at 8.3 °C. It has been above 8.0 °C for 5 minutes. ' +
        'Door: closed.\nReply 1 to acknowledge, 2 to mute for 1 hour.',
    );
  });

  it('has an Arabic variant and a resolved variant', () => {
    expect(renderText({ ...fridge, locale: 'ar' })).toContain('تنبيه نبض · تحذير');
    expect(renderText({ ...fridge, reason: 'resolved' })).toMatch(
      /^Nabd alert · Resolved[\s\S]*No action needed\.$/,
    );
  });
});

describe('WhatsAppProvider', () => {
  it('sends the nabd_alert template with four body parameters', async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const p = new WhatsAppProvider({ token: 't', phoneNumberId: '123', fetchImpl });
    expect(await p.send('+201000000000', fridge)).toEqual({ providerMessageId: 'wamid.1' });
    expect(sent!.url).toBe('https://graph.facebook.com/v23.0/123/messages');
    expect(sent!.body).toMatchObject({
      to: '201000000000',
      type: 'template',
      template: { name: 'nabd_alert', language: { code: 'en' } },
    });
  });

  it('marks 4xx errors as not worth retrying', async () => {
    const fetchImpl = (async () => new Response('{"error":{}}', { status: 400 })) as unknown as typeof fetch;
    await expect(
      new WhatsAppProvider({ token: 't', phoneNumberId: '1', fetchImpl }).send('+1', fridge),
    ).rejects.toMatchObject({
      retryable: false,
    });
  });
});

describe('sendWithRetry', () => {
  it('retries transient failures and reports every attempt', async () => {
    let calls = 0;
    const flaky: Provider = {
      channel: 'whatsapp',
      send: async () => {
        if (++calls < 3) throw new ProviderError('HTTP 503', true);
        return { providerMessageId: 'ok' };
      },
    };
    const attempts: Attempt[] = [];
    const result = await sendWithRetry(flaky, '+1', fridge, {
      baseDelayMs: 1,
      onAttempt: (a) => void attempts.push(a),
    });
    expect(result).toMatchObject({ ok: true, attempt: 3 });
    expect(attempts.map((a) => a.ok)).toEqual([false, false, true]);
  });

  it('stops at once on a permanent failure and never throws', async () => {
    const broken: Provider = {
      channel: 'email',
      send: async () => {
        throw new ProviderError('HTTP 422', false);
      },
    };
    expect(await sendWithRetry(broken, 'a@b', fridge, { baseDelayMs: 1 })).toMatchObject({
      ok: false,
      attempt: 1,
    });
  });
});

describe('providersFromEnv', () => {
  it('falls back to the console when no credentials are set (the demo)', () => {
    const p = providersFromEnv({}, () => {});
    expect(p.whatsapp).toBeInstanceOf(ConsoleProvider);
    expect(p.email).toBeInstanceOf(ConsoleProvider);
  });
});
