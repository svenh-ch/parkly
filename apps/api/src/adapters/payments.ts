import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Zahlungs-Port.
 *
 * Stripe (Standard in Produktion), Modell "separate charges and transfers":
 *  - Der Mieter bezahlt an Parkly (PaymentIntent, CHF, Karte/Apple Pay/TWINT je nach Dashboard).
 *  - Nach Ende der Buchung überweist Parkly den Vermieteranteil an dessen Stripe-Connect-Konto (Transfer).
 *  - So kann ein Vermieter auch ohne fertiges Auszahlungskonto schon vermieten; das Geld wartet.
 * Kundengeld liegt bei Stripe, nie auf einem eigenen Bankkonto von Parkly.
 *
 * "dev": Testzahlung ohne Stripe (nur Entwicklung, in production gesperrt).
 */

export type IntentStatus = 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'succeeded' | 'canceled' | 'requires_capture';

export interface PaymentProvider {
  readonly name: 'stripe' | 'dev';
  readonly publishableKey: string | null;
  ensureCustomer(user: { id: string; email: string; name: string | null }, existingId: string | null): Promise<string | null>;
  ephemeralKey(customerId: string): Promise<string | null>;
  createIntent(p: { amount: number; currency: string; customerId: string | null; metadata: Record<string, string>; transferGroup: string; description: string }): Promise<{ id: string; clientSecret: string | null }>;
  retrieveIntent(id: string): Promise<{ status: IntentStatus; methodType: string | null }>;
  cancelIntent(id: string): Promise<void>;
  /** TWINT direkt bestätigen (ohne Zahlungsblatt): liefert die Weiterleitung zur TWINT-App. */
  confirmTwint(intentId: string, returnUrl: string): Promise<{ redirectUrl: string | null; status: IntentStatus }>;
  refund(intentId: string, amount: number, idempotencyKey: string): Promise<{ id: string; status: string }>;
  transfer(p: { amount: number; currency: string; destination: string; transferGroup: string; idempotencyKey: string }): Promise<{ id: string }>;
  createConnectAccount(email: string): Promise<string>;
  accountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string>;
  retrieveAccount(id: string): Promise<{ payoutsEnabled: boolean; chargesEnabled: boolean; detailsSubmitted: boolean }>;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

/** Stripe erwartet application/x-www-form-urlencoded mit Klammer-Notation für verschachtelte Werte. */
export function formEncode(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => out.push(...(typeof item === 'object' ? formEncode(item as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`])));
    else if (typeof v === 'object') out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export const STRIPE_API_VERSION = '2024-06-20';

export class StripePayments implements PaymentProvider {
  readonly name = 'stripe' as const;

  constructor(
    private readonly secretKey: string,
    readonly publishableKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.stripe.com',
  ) {}

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
    const body = formEncode(params).join('&');
    const url = method === 'GET' && body ? `${this.baseUrl}${path}?${body}` : `${this.baseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Stripe-Version': STRIPE_API_VERSION,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
    if (!res.ok) throw new PaymentError(json.error?.message ?? `Stripe HTTP ${res.status}`, res.status, json.error?.code ?? null);
    return json;
  }

  async ensureCustomer(user: { id: string; email: string; name: string | null }, existingId: string | null) {
    if (existingId) return existingId;
    const c = await this.call<{ id: string }>('POST', '/v1/customers', { email: user.email, name: user.name ?? undefined, metadata: { userId: user.id } }, `customer-${user.id}`);
    return c.id;
  }

  async ephemeralKey(customerId: string) {
    const k = await this.call<{ secret: string }>('POST', '/v1/ephemeral_keys', { customer: customerId });
    return k.secret;
  }

  async createIntent(p: { amount: number; currency: string; customerId: string | null; metadata: Record<string, string>; transferGroup: string; description: string }) {
    const pi = await this.call<{ id: string; client_secret: string }>(
      'POST',
      '/v1/payment_intents',
      {
        amount: p.amount,
        currency: p.currency.toLowerCase(),
        customer: p.customerId ?? undefined,
        automatic_payment_methods: { enabled: true },
        transfer_group: p.transferGroup,
        description: p.description,
        metadata: p.metadata,
      },
      `pi-${p.metadata.paymentId}`,
    );
    return { id: pi.id, clientSecret: pi.client_secret };
  }

  async retrieveIntent(id: string) {
    const pi = await this.call<{ status: IntentStatus; payment_method_types?: string[]; latest_charge?: { payment_method_details?: { type?: string } } | string | null }>(
      'GET',
      `/v1/payment_intents/${encodeURIComponent(id)}`,
      { expand: ['latest_charge'] },
    );
    const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    return { status: pi.status, methodType: charge?.payment_method_details?.type ?? null };
  }

  async cancelIntent(id: string) {
    await this.call('POST', `/v1/payment_intents/${encodeURIComponent(id)}/cancel`).catch(() => undefined);
  }

  async confirmTwint(intentId: string, returnUrl: string) {
    const pi = await this.call<{ status: IntentStatus; next_action?: { redirect_to_url?: { url?: string } } | null }>(
      'POST',
      `/v1/payment_intents/${encodeURIComponent(intentId)}/confirm`,
      { payment_method_data: { type: 'twint' }, return_url: returnUrl },
    );
    return { redirectUrl: pi.next_action?.redirect_to_url?.url ?? null, status: pi.status };
  }

  async refund(intentId: string, amount: number, idempotencyKey: string) {
    const r = await this.call<{ id: string; status: string }>('POST', '/v1/refunds', { payment_intent: intentId, amount }, idempotencyKey);
    return { id: r.id, status: r.status };
  }

  async transfer(p: { amount: number; currency: string; destination: string; transferGroup: string; idempotencyKey: string }) {
    const t = await this.call<{ id: string }>(
      'POST',
      '/v1/transfers',
      { amount: p.amount, currency: p.currency.toLowerCase(), destination: p.destination, transfer_group: p.transferGroup },
      p.idempotencyKey,
    );
    return { id: t.id };
  }

  async createConnectAccount(email: string) {
    const a = await this.call<{ id: string }>('POST', '/v1/accounts', {
      type: 'express',
      country: 'CH',
      email,
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
      business_profile: { product_description: 'Vermietung von Parkplätzen über Parkly' },
    });
    return a.id;
  }

  async accountLink(accountId: string, refreshUrl: string, returnUrl: string) {
    const l = await this.call<{ url: string }>('POST', '/v1/account_links', {
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return l.url;
  }

  async retrieveAccount(id: string) {
    const a = await this.call<{ payouts_enabled: boolean; charges_enabled: boolean; details_submitted: boolean }>('GET', `/v1/accounts/${encodeURIComponent(id)}`);
    return { payoutsEnabled: a.payouts_enabled, chargesEnabled: a.charges_enabled, detailsSubmitted: a.details_submitted };
  }
}

/** Prüft die Stripe-Signatur eines Webhooks (Header "Stripe-Signature"). */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, toleranceSeconds = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  const signatures = header
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));
  if (!Number.isFinite(t) || !signatures.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

// ─── Testzahlung ──────────────────────────────────────────────────────────

export class DevPayments implements PaymentProvider {
  readonly name = 'dev' as const;
  readonly publishableKey = null;
  private intents = new Map<string, IntentStatus>();

  async ensureCustomer() {
    return null;
  }
  async ephemeralKey() {
    return null;
  }
  async createIntent() {
    const id = `dev_pi_${randomUUID()}`;
    this.intents.set(id, 'requires_payment_method');
    return { id, clientSecret: null };
  }
  /** Nur die Testzahlung ruft das auf. */
  succeed(id: string) {
    this.intents.set(id, 'succeeded');
  }
  async retrieveIntent(id: string) {
    return { status: this.intents.get(id) ?? 'requires_payment_method', methodType: this.intents.get(id) === 'succeeded' ? 'test' : null };
  }
  async cancelIntent(id: string) {
    this.intents.set(id, 'canceled');
  }
  async confirmTwint(id: string) {
    this.intents.set(id, 'succeeded');
    return { redirectUrl: null, status: 'succeeded' as IntentStatus };
  }
  async refund() {
    return { id: `dev_re_${randomUUID()}`, status: 'succeeded' };
  }
  async transfer() {
    return { id: `dev_tr_${randomUUID()}` };
  }
  async createConnectAccount(): Promise<string> {
    throw new PaymentError('Auszahlungskonten gibt es nur mit Stripe (PAYMENT_PROVIDER=stripe).', 503);
  }
  async accountLink(): Promise<string> {
    throw new PaymentError('Auszahlungskonten gibt es nur mit Stripe.', 503);
  }
  async retrieveAccount() {
    return { payoutsEnabled: false, chargesEnabled: false, detailsSubmitted: false };
  }
}
