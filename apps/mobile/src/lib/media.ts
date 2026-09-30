import { env } from './env';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '0.0.0.0']);

/**
 * Datei-URLs vom Server (signierte Foto-URLs) auf eine Adresse umbiegen, die das Handy erreicht.
 * Lokal meldet der Server "127.0.0.1" — das wäre auf dem iPhone das iPhone selbst.
 */
export function mediaUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!LOOPBACK.has(u.hostname)) return url;
    const supa = new URL(env.supabaseUrl);
    const apiBase = new URL(env.apiUrl);
    const target = u.port === supa.port ? supa : u.port === apiBase.port ? apiBase : null;
    if (!target || LOOPBACK.has(target.hostname) === LOOPBACK.has(u.hostname) && target.hostname === u.hostname) return url;
    u.protocol = target.protocol;
    u.hostname = target.hostname;
    u.port = target.port;
    return u.toString();
  } catch {
    return url;
  }
}
