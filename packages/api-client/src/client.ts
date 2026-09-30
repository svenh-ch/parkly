import type { z } from 'zod';
import { apiErrorSchema, type ErrorCode } from '@parking/shared';

/**
 * Plattformunabhängiger HTTP-Client für die Parking-API.
 * Wird von Mobile-App, späterer Web-App, Host- und Admin-Dashboard gemeinsam genutzt.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE',
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthenticated() {
    return this.status === 401;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Liefert das aktuelle Access Token (oder null, wenn nicht eingeloggt). */
  getAccessToken: () => Promise<string | null>;
  /** Wird bei 401 aufgerufen, z. B. um die Session zu beenden. */
  onUnauthenticated?: () => void;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions<T> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Zod-Schema zur Validierung der Antwort. Ohne Schema wird nichts zurückgegeben. */
  schema?: z.ZodType<T>;
  auth?: boolean;
  signal?: AbortSignal;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  async request<T = void>(method: Method, path: string, options: RequestOptions<T> = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.auth !== false) {
      const token = await this.opts.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15_000);
    options.signal?.addEventListener('abort', () => controller.abort());

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new ApiError(0, 'TIMEOUT', 'Der Server antwortet nicht. Bitte versuche es erneut.');
      }
      throw new ApiError(0, 'NETWORK_ERROR', 'Keine Verbindung. Bitte prüfe deine Internetverbindung.', err);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const parsed = apiErrorSchema.safeParse(payload);
      if (response.status === 401) this.opts.onUnauthenticated?.();
      if (parsed.success) {
        const e = parsed.data.error;
        throw new ApiError(response.status, e.code as ErrorCode, e.message, e.details, e.requestId);
      }
      throw new ApiError(response.status, 'INTERNAL', 'Unerwarteter Serverfehler');
    }

    if (!options.schema || response.status === 204) return undefined as T;

    const json = await response.json().catch(() => undefined);
    const result = options.schema.safeParse(json);
    if (!result.success) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'Unerwartete Antwort vom Server', result.error.issues);
    }
    return result.data;
  }
}
