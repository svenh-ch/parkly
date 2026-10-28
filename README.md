# Parkly – Marketplace für Parkplätze in der Schweiz

Monorepo für die Mobile-App (Expo), die API (Fastify + PostgreSQL/PostGIS) und geteilte Pakete.
Start: Zürich. Nichts ist auf Zürich fest verdrahtet (Regionen, Währung, Gebühren liegen in der Datenbank).

```
apps/
  api/          Fastify-API, Drizzle-Schema, Migrationen, Tests
  mobile/       Expo-App (iOS/Android, Web vorbereitet)
packages/
  shared/       Enums, Zod-Schemas, Preis-Engine, Geld-Helfer (Client + Server)
  api-client/   Typisierter HTTP-Client für alle Frontends
supabase/       Lokale Supabase-Konfiguration (Auth, Storage, Postgres)
docs/           Architektur und Roadmap
```

## Voraussetzungen (Mac)

- Node.js 22 oder neuer (`node -v`)
- pnpm über Corepack: `corepack enable`
- Docker Desktop (für die lokale Supabase-Instanz)
- iOS Simulator (Xcode) und/oder Android Studio, oder die App **Expo Go** auf dem Handy

## Täglich starten (nach der Ersteinrichtung)

1. Docker Desktop öffnen (Wal-Symbol in der Menüleiste muss ruhig sein)
2. Im Terminal:
   ```bash
   cd parkly   # in den Projektordner wechseln
   pnpm dev
   ```
   Startet Datenbank, spielt neue Migrationen und Stammdaten ein, startet die API im Hintergrund
   (Meldungen mit `[api]` markiert) und die App im Vordergrund.
3. QR-Code mit der iPhone-Kamera scannen (Expo Go, gleiches WLAN)
4. Beenden mit **Ctrl + C** (stoppt App und API; die Datenbank läuft weiter, stoppen mit `pnpm db:stop`)

Nach einem Update des Codes zuerst `pnpm install`, dann `pnpm dev`.

## Ersteinrichtung

```bash
# 1) Abhängigkeiten
pnpm install

# 2) Lokales Backend (Postgres + Auth + Storage + Mailpit) starten
pnpm db:start
#    Die Ausgabe enthält URLs und Schlüssel. Jederzeit erneut: npx supabase status

# 3) API konfigurieren
cp apps/api/.env.example apps/api/.env
#    SUPABASE_SERVICE_ROLE_KEY = "Secret key" / "service_role key" aus der Ausgabe von Schritt 2

# 4) Datenbank aufsetzen
pnpm db:migrate
pnpm db:seed

# 5) API starten (Port 4000)
pnpm api
#    Test: http://localhost:4000/health/ready  ·  OpenAPI: http://localhost:4000/docs/openapi.json

# 6) App konfigurieren und starten (neues Terminal)
cp apps/mobile/.env.example apps/mobile/.env
#    EXPO_PUBLIC_SUPABASE_ANON_KEY = "Publishable key" / "anon key" aus Schritt 2
pnpm mobile
#    i = iOS Simulator, a = Android Emulator, oder QR-Code mit Expo Go scannen
```

E-Mails (Registrierung, Passwort-Reset) landen lokal in **Mailpit**: http://127.0.0.1:54324

> Auf einem echten Handy verwendet die App automatisch die IP deines Macs (Handy und Mac im selben WLAN).

## Datenquellen Karte

| Quelle | Inhalt | Lizenz | Aktualisierung |
|---|---|---|---|
| Parkleitsystem Stadt Zürich (`pls-zh.ch/plsFeed/rss`) | Freie Plätze, offen/geschlossen | CC0 | alle 3 Min. (API-Hintergrundjob, `PLS_SYNC_INTERVAL_SECONDS`) |
| `apps/api/data/zuerich-parkleitsystem.geojson` | Standorte + Kapazität der PLS-Parkhäuser | MIT (ParkAPI-Projekt) | beim Seed |
| Karte (Apple Maps / Google Maps) | Kartenbild | Plattform-SDK | – |
| Stadt Luzern: Öffentliche Parkierungsanlagen (WFS, opendata.swiss) | 24 Parkhäuser/Tiefgaragen mit Kapazität, Öffnungszeiten, Link | opendata.swiss „terms_open“: frei, kommerziell erlaubt | unregelmässig (Snapshot 30.09.2026 in `apps/api/data/regions/luzern.json`) |
| Stadt Zug: Parkplatzkataster (data.zg.ch, opendata.swiss) | öffentliche Parkplätze ≥ 15 Felder, Gebühren, Zeiten | „terms_by“: frei, kommerziell erlaubt, **Quellenangabe Pflicht** | wöchentlich (Snapshot 30.09.2026 in `zug.json`) |
| Parkleitsystem Zug (pls-zug.ch) | Namen + Adressen der 18 Parkhäuser (Fakten), verortet mit swisstopo | – | Snapshot 30.09.2026 |
| Stadt Zug, Website „Parkieren“ | Tarife der 4 städtischen Parkhäuser | öffentliche Verordnung | Stand 30.09.2026 |
| Echtzeit Luzern (info.pls-luzern.ch) / Zug (pls-zug.ch) | freie Plätze | **keine offene Lizenz** → Adapter vorhanden, aber AUS bis zur Zustimmung der Betreiber (`LIVE_LUZERN_ENABLED`, `LIVE_ZUG_ENABLED`) | alle 3 Min. |
| openrouteservice Geocoding (Pelias, OSM) | Geschäfte, Restaurants, Hotels, Spitäler usw. in der Suche | OSM ODbL, Quellenangabe in der Suche; 3000/Tag gratis | pro Anfrage, 24 h Cache |
| openrouteservice Matrix (foot-walking) | Gehdistanz Parkplatz ↔ gesuchter Ort | wie oben; 500/Tag gratis | pro Anfrage, 10 Min. Cache |
| openrouteservice (HeiGIT) | Autoroute + Abbiege-Anweisungen (In-App-Route) | OSM-Daten ODbL, Quellenangabe in der App; Gratis-Plan kommerziell erlaubt | pro Anfrage (2000/Tag, 40/Min. gratis) |

Parkhäuser, die neu im Feed erscheinen, verortet die API automatisch über ihre Adresse
(swisstopo SearchServer, freie Geodaten des Bundes, Quellenangabe © swisstopo) und legt sie an.
Klappt das nicht, erscheint eine Warnung im Log.

## Parkplatz inserieren und Fotos

- Assistent in 7 Schritten (App: Vermieten → Parkplatz inserieren). Jeder Schritt speichert, Entwürfe erscheinen unter „Meine Parkplätze“.
- Fotos: 3–10 pro Platz. Die App verkleinert auf max. 2048 px und speichert neu als JPEG; dabei gehen alle EXIF-Daten (GPS, Kamera) verloren.
  Upload direkt in Supabase Storage (privater Bucket `spot-images`) über eine signierte, kurz gültige Upload-URL; die API prüft danach
  Grösse (≤ 10 MB) und Dateityp anhand der ersten Bytes. Anzeige nur über signierte Lese-URLs (1 h).
- Öffentlich sichtbar ist nur eine um 120–250 m verschobene Position, PLZ/Ort, keine Adresse, Platznummer oder Zugangsinfos.
- Braucht `SUPABASE_SERVICE_ROLE_KEY` in `apps/api/.env`. Klappt der Upload nicht, dort den „service_role key“ (beginnt mit `eyJ`)
  aus `npx supabase status -o env` eintragen.

## Tarife

Rechtliche Einschätzung (keine Rechtsberatung): Einzelne Preise sind Fakten und urheberrechtlich nicht geschützt, und die Schweiz kennt
keinen eigenen Datenbankschutz. Das systematische, automatische Übernehmen fremder Angebote für ein eigenes kommerzielles Angebot kann aber
unlauter sein (Art. 5 lit. c UWG; BGE 131 III 384 „Such-Spider“, übernommene Immobilienanzeigen). Deshalb:

- **Keine automatische Übernahme von Betreiber-Websites.**
- Automatisch nur aus offenen Daten (z. B. Parkplatzkataster Stadt Zug) oder amtlichen Erlassen (Tarife der städtischen Parkhäuser Zug).
- Sonst: Admins erfassen Tarife von Hand mit „Stand vom“ und Quelle (App: Parkhaus → „Tarife bearbeiten“), oder der Betreiber liefert sie.
- Admin-Rolle vergeben: `pnpm --filter @parking/api admin:grant deine@email.ch`

## Regionen hinzufügen

Eine neue Stadt ist eine neue Datei in `apps/api/data/regions/<stadt>.json` (Region, Datenquellen, Parkhäuser, Tarife).
`pnpm db:seed` (läuft bei `pnpm dev` automatisch) importiert sie; am Code muss nichts geändert werden.
Echtzeit-Belegung: Feld `liveKey` pro Parkhaus + Adapter in `apps/api/src/adapters/parking-data/`.

## In-App-Route

Die Route läuft über unsere API (`POST /v1/route`) zu einem Routing-Dienst; der Key liegt nur in `apps/api/.env`.

| Dienst | Kosten | Kommerziell | Auf Apple Maps anzeigen | Bemerkung |
|---|---|---|---|---|
| **openrouteservice** (Standard) | gratis, 2000 Routen/Tag | ja | ja | OSM-Daten, in der Schweiz sehr gut; keine Live-Verkehrslage |
| Mapbox Directions | 100 000/Monat gratis, danach ab 2 USD/1000 | ja | nicht ausgeschlossen | mit Verkehrslage; Ergebnisse dürfen nicht gespeichert werden; Kreditkarte nötig |
| Google Routes | kostenpflichtig | ja | **nein** (nur auf Google-Karte erlaubt) | in Expo Go auf iOS nicht nutzbar |

Einrichten: Konto auf https://openrouteservice.org/dev/#/signup, Key kopieren, in `apps/api/.env` `ORS_API_KEY=…` eintragen, API neu starten.
Ohne Key zeigt die App den Fallback „In Apple/Google Maps öffnen“.

Expo Go: Route, Navigationsmodus, Ansagen und Bildschirm-bleibt-an funktionieren. Navigation bei gesperrtem Bildschirm
oder im Hintergrund braucht einen Development Build mit Hintergrund-Standort (und dafür den Apple Developer Account, 99 USD/Jahr).
In der Entwicklung gibt es „Fahrt simulieren“, damit man den Navigationsmodus ohne Auto testen kann.

Datenschutz: Start und Ziel gehen über unsere API an openrouteservice (Heidelberg, DE), werden bei uns weder gespeichert noch geloggt.
In der Datenschutzerklärung erwähnen.

## Buchen, Bezahlen, Treueprogramm

Ablauf: Zeit wählen → Preis vom Server (inkl. Status-Rabatt) → Platz 15 Min. reserviert → bezahlen →
sofort bestätigt (oder „auf Anfrage“: Vermieter hat 24 Std., sonst automatische Rückerstattung) →
nach dem Ende abgeschlossen → Auszahlung an den Vermieter 24 Std. später.

- **Testmodus** (`PAYMENT_PROVIDER=dev`): Zahlungen werden nur simuliert, es fliesst kein Geld. Funktioniert auch im Web.
- **Stripe** (`PAYMENT_PROVIDER=stripe`): Karte, TWINT, Apple/Google Pay über das Stripe-Zahlungsblatt.
  Modell „separate Zahlung und Überweisung“: der Mieter zahlt an Parkly, der Vermieteranteil geht nach der Buchung an
  sein Stripe-Express-Konto. Kundengeld liegt bei Stripe, nie auf einem eigenen Konto.
  Lokal braucht es keinen Webhook: die App fragt den Zahlungsstatus selbst ab. In Produktion ist `STRIPE_WEBHOOK_SECRET` Pflicht
  (Endpunkt `https://<api>/v1/webhooks/stripe`, Events `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`).
- Apple Pay und Google Pay erscheinen erst in einem Development Build (nicht in Expo Go). Karte und TWINT gehen auch in Expo Go.
- Storno: vor der Frist (Flexibel 1 Std., Moderat 24 Std., Streng 7 Tage) alles zurück inkl. Servicegebühr, danach nichts.
  Storniert oder lehnt der Vermieter ab: immer alles zurück.
- Treueprogramm: Stufen, Gebühren und Vorkauf-Stunden stehen in der Tabelle `loyalty_tiers` und sind ohne Code-Änderung anpassbar.
  Events mit Vorkauf legt ein Admin über `POST /v1/admin/events` an.

## Tests

```bash
pnpm test        # alle Pakete
pnpm typecheck   # TypeScript in allen Paketen
```

Die API-Integrationstests laufen gegen eine echte Datenbank (`TEST_DATABASE_URL` in `apps/api/.env`,
Name muss auf `_test` enden und wird bei jedem Lauf neu aufgebaut). Ohne diese Variable laufen nur Unit-Tests.

## Wichtige Regeln

- **Keine Secrets im Code oder in `EXPO_PUBLIC_*`-Variablen.** Alles, was mit `EXPO_PUBLIC_` beginnt, ist im App-Bundle öffentlich.
- **Alle Fachdaten laufen über die API.** Die App nutzt Supabase nur für Login (und später für direkte Bild-Uploads).
  Die Tabellen haben RLS aktiviert und sind für die Supabase Data API gesperrt.
  Neue Tabellen in künftigen Migrationen ebenfalls mit `ENABLE ROW LEVEL SECURITY` anlegen.
- **Schema ändern:** `apps/api/src/db/schema/*` anpassen, dann `pnpm --filter @parking/api db:generate` und `pnpm db:migrate`.
  Nicht `supabase db reset` verwenden (setzt die Datenbank ohne unsere Migrationen zurück; danach `pnpm db:migrate && pnpm db:seed`).
- **Dev-Adapter** (`PAYMENT_PROVIDER=dev` usw.) sind nur für die Entwicklung. Mit `NODE_ENV=production` startet die API damit nicht.

## Stand

Siehe [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) für Architektur, Entscheidungen und Roadmap.
