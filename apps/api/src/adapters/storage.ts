import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Datei-Speicher für Parkplatz-Fotos.
 *
 * Ablauf (Bilder gehen nie durch die API):
 *  1. App fragt eine Upload-Erlaubnis an -> signierte Upload-URL (kurz gültig, genau ein Pfad)
 *  2. App lädt das (bereits verkleinerte, EXIF-freie) Bild direkt hoch
 *  3. App meldet "fertig" -> API prüft Grösse, Typ und die ersten Bytes (Magic Number)
 *  4. Anzeige nur über signierte Lese-URLs (Bucket ist privat)
 *
 * Adapter: Supabase Storage (Standard) und "dev" (lokale Dateien, nur Entwicklung/Tests, in production gesperrt).
 */
export interface StoredObject {
  size: number;
  contentType: string | null;
}

export interface StorageProvider {
  createUploadUrl(key: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }>;
  stat(key: string): Promise<StoredObject | null>;
  /** Die ersten Bytes (für die Prüfung des Dateityps). */
  head(key: string, bytes: number): Promise<Uint8Array | null>;
  signedReadUrls(keys: string[], expiresInSeconds: number): Promise<Map<string, string>>;
  remove(keys: string[]): Promise<void>;
}

/** Prüft die ersten Bytes auf JPEG, PNG oder WebP. */
export function sniffImageType(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === 'RIFF' &&
    String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// ─── Supabase ────────────────────────────────────────────────────────────

export class SupabaseStorage implements StorageProvider {
  private bucketReady: Promise<void> | null = null;

  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket = 'spot-images',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get base() {
    return `${this.supabaseUrl.replace(/\/$/, '')}/storage/v1`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    // Neue Schlüssel (sb_secret_…) nur als apikey; alte JWT-Schlüssel zusätzlich als Bearer
    const h: Record<string, string> = { apikey: this.serviceKey, ...extra };
    if (!this.serviceKey.startsWith('sb_')) h.Authorization = `Bearer ${this.serviceKey}`;
    return h;
  }

  private encodePath(key: string) {
    return key.split('/').map(encodeURIComponent).join('/');
  }

  /** Legt den privaten Bucket beim ersten Gebrauch an (idempotent). */
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      const res = await this.fetchImpl(`${this.base}/bucket`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: this.bucket,
          name: this.bucket,
          public: false,
          file_size_limit: 10 * 1024 * 1024,
          allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
        }),
      });
      if (!res.ok && res.status !== 409 && res.status !== 400) {
        const text = await res.text();
        if (!/already exists|Duplicate/i.test(text)) {
          this.bucketReady = null;
          throw new Error(`Storage-Bucket konnte nicht angelegt werden (HTTP ${res.status}): ${text.slice(0, 200)}`);
        }
      }
    })();
    return this.bucketReady;
  }

  async createUploadUrl(key: string, contentType: string) {
    await this.ensureBucket();
    const res = await this.fetchImpl(`${this.base}/object/upload/sign/${this.bucket}/${this.encodePath(key)}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    if (!res.ok) throw new Error(`Upload-URL fehlgeschlagen (HTTP ${res.status})`);
    const body = (await res.json()) as { url?: string };
    if (!body.url) throw new Error('Upload-URL fehlt in der Antwort');
    return { url: `${this.base}${body.url}`, headers: { 'Content-Type': contentType, 'x-upsert': 'false' } };
  }

  async stat(key: string): Promise<StoredObject | null> {
    const dir = key.split('/').slice(0, -1).join('/');
    const name = key.split('/').at(-1)!;
    const res = await this.fetchImpl(`${this.base}/object/list/${this.bucket}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix: dir, search: name, limit: 5, offset: 0 }),
    });
    if (!res.ok) throw new Error(`Storage-Liste fehlgeschlagen (HTTP ${res.status})`);
    const items = (await res.json()) as { name?: string; metadata?: { size?: number; mimetype?: string } | null }[];
    const hit = items.find((i) => i.name === name);
    if (!hit?.metadata) return null;
    return { size: Number(hit.metadata.size ?? 0), contentType: hit.metadata.mimetype ?? null };
  }

  async head(key: string, bytes: number): Promise<Uint8Array | null> {
    const res = await this.fetchImpl(`${this.base}/object/authenticated/${this.bucket}/${this.encodePath(key)}`, {
      headers: this.headers({ Range: `bytes=0-${bytes - 1}` }),
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer()).slice(0, bytes);
  }

  async signedReadUrls(keys: string[], expiresInSeconds: number) {
    const out = new Map<string, string>();
    if (!keys.length) return out;
    const res = await this.fetchImpl(`${this.base}/object/sign/${this.bucket}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: expiresInSeconds, paths: keys }),
    });
    if (!res.ok) throw new Error(`Signierte URLs fehlgeschlagen (HTTP ${res.status})`);
    const items = (await res.json()) as { path?: string; signedURL?: string | null; error?: string | null }[];
    for (const i of items) {
      if (i.path && i.signedURL) out.set(i.path, `${this.base}${i.signedURL}`);
    }
    return out;
  }

  async remove(keys: string[]) {
    if (!keys.length) return;
    await this.fetchImpl(`${this.base}/object/${this.bucket}`, {
      method: 'DELETE',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: keys }),
    });
  }
}

// ─── Entwicklung: lokale Dateien, ausgeliefert über /dev-storage ─────────

export class DevStorage implements StorageProvider {
  constructor(
    private readonly dir: string,
    /** Basis-URL der API, wie die App sie erreicht, z. B. http://192.168.1.20:4000 */
    private readonly publicBaseUrl: string,
    private readonly secret: string,
  ) {}

  private file(key: string) {
    const full = path.resolve(this.dir, key);
    if (!full.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('Ungültiger Pfad');
    return full;
  }

  sign(op: 'put' | 'get', key: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${op}:${key}:${exp}`).digest('base64url');
  }

  verify(op: 'put' | 'get', key: string, exp: number, sig: string) {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    const a = Buffer.from(this.sign(op, key, exp));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private url(op: 'put' | 'get', key: string, ttl: number) {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    return `${this.publicBaseUrl.replace(/\/$/, '')}/dev-storage/${op === 'put' ? 'upload' : 'object'}/${key}?exp=${exp}&sig=${this.sign(op, key, exp)}`;
  }

  async createUploadUrl(key: string, contentType: string) {
    return { url: this.url('put', key, 600), headers: { 'Content-Type': contentType } };
  }

  async write(key: string, data: Buffer, contentType: string) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
    await writeFile(`${f}.type`, contentType);
  }

  async read(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const f = this.file(key);
      return { data: await readFile(f), contentType: (await readFile(`${f}.type`, 'utf8')) || 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  async stat(key: string) {
    try {
      const f = this.file(key);
      const s = await stat(f);
      const type = await readFile(`${f}.type`, 'utf8').catch(() => null);
      return { size: s.size, contentType: type };
    } catch {
      return null;
    }
  }

  async head(key: string, bytes: number) {
    const r = await this.read(key);
    return r ? new Uint8Array(r.data.subarray(0, bytes)) : null;
  }

  async signedReadUrls(keys: string[], expiresInSeconds: number) {
    return new Map(keys.map((k) => [k, this.url('get', k, expiresInSeconds)]));
  }

  async remove(keys: string[]) {
    for (const k of keys) {
      const f = this.file(k);
      await rm(f, { force: true });
      await rm(`${f}.type`, { force: true });
    }
  }
}
