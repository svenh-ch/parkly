# Architektur

## Überblick

```
Mobile App (Expo)            später: Web-App · Host-Dashboard · Admin-Dashboard
   │  @parking/api-client (typisiert, Zod-validiert)
   │  Bearer-Token von Supabase Auth
   ▼
API (Fastify, /v1)
   Routes → Zod-Validierung → Auth/Rollen → Services → Drizzle → PostgreSQL + PostGIS
   Adapter (austauschbar): IdentityProvider · PaymentProvider · StorageProvider · ParkingDataSource
   ▼
Supabase: Postgres, Auth, Storage       Stripe Connect       Open Data Stadt Zürich / OSM
```

## Entscheidungen

| Thema | Entscheidung | Grund |
|---|---|---|
| Doppelbuchungen | `EXCLUDE USING gist (spot_id =, tstzrange(start_at, end_at) &&)` für `PENDING_PAYMENT`/`CONFIRMED` | Atomar in der Datenbank, auch bei parallelen Requests (getestet). |
| Bewertungen | Private Plätze: Trigger (nur Autor der Buchung, nur nach Ende), `UNIQUE(booking_id)`. Parkhäuser: eine Bewertung pro Nutzer (Partial Unique Index). Durchschnitt denormalisiert, nur sichtbare Bewertungen zählen. | Regeln gelten unabhängig vom Code, der schreibt. |
| Favoriten auf der Karte | Favoriten werden nie geclustert und als eigene Pins mitgeliefert; personalisierte Antworten `Cache-Control: private, no-store` | Herz immer sichtbar; keine veralteten Antworten aus HTTP-Caches. |
| Beträge | Integer in Rappen, Snapshot in der Buchung, Check `platform_fee + host_payout = subtotal` | Keine Rundungsfehler, spätere Gebührenänderungen verändern keine alten Buchungen. |
| Plattformgebühr | Tabelle `platform_fee_rules` (pro Region/Vermieterstufe, zeitlich gültig) | Konfigurierbar ohne Deployment. |
| Öffentlich vs. privat | `parking_facilities` (PUBLIC_PARKING, importiert) getrennt von `parking_spots` (PRIVATE_MARKETPLACE_PARKING) | Unterschiedliche Herkunft, Lizenz, Lebenszyklus und Buchbarkeit. |
| Standort-Privatsphäre | `approx_location` öffentlich, `location` + `access_instructions` erst nach bestätigter Buchung | Schutz der Vermieter. |
| Auth | Supabase Auth; API prüft JWT (JWKS/ES256, optional HS256); Rollen in eigener Tabelle `user_roles` | Keine Passwörter in unserer DB, Rollen nicht vom Client manipulierbar. |
| Konto löschen | Personendaten entfernt, Buchungen/Zahlungen pseudonymisiert behalten | revDSG + Aufbewahrungspflicht OR. |
| GPS | Wird nicht serverseitig gespeichert; nur als Suchparameter | Datensparsamkeit. |

## Datenmodell

Tabellen: `users`, `user_roles`, `host_profiles`, `push_tokens`, `regions`, `platform_fee_rules`, `addresses`,
`data_sources`, `parking_facilities`, `facility_tariffs`, `facility_occupancy`, `parking_spots`, `images`,
`availability_rules`, `availability_exceptions`, `bookings`, `payments`, `refunds`, `payouts`, `payment_events`,
`reviews`, `favorites`, `notifications`, `reports`, `audit_logs`.

Quelle der Wahrheit: `apps/api/src/db/schema/`. Constraints und Trigger: `apps/api/drizzle/0002_booking_constraints.sql`.

## Roadmap

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Monorepo, DB-Schema + Migrationen, API-Grundgerüst, Design-System, Tabs | ✅ |
| 2 | Registrierung, Login, Passwort-Reset, Profil, Rollen (Vermieter werden), Konto löschen | ✅ |
| 3 | Parkhäuser Zürich + Live-Belegung (Parkleitsystem), weltweit zoombare Karte, GPS, Pins/Cluster, Bottom Sheet, Route, Detailseite, „In deiner Nähe“, Logo | ✅ |
| 4 | Vermieter: Inserat-Assistent, Bilder-Upload, Verfügbarkeit, Meine Parkplätze, Detailseite, Veröffentlichen (Stripe Connect Onboarding folgt mit Buchungen) | ✅ |
| 5a | Name Parkly, Königsblau-Akzente, gefüllte Favoriten-Pins, Home nie leer (nächste Parkhäuser), Ortssuche (swisstopo) mit Vorschlägen + letzte Suchen (nur Gerät) | ✅ |
| 5b | In-App-Route: Routing-Adapter (openrouteservice/Mapbox), Navigationsmodus mit Auto-Icon, Manöver, Ansagen, Neuberechnung, Ankunft, Simulation | ✅ |
| 5c | Suche mit Orten/Geschäften (POI-Adapter), Kamera-Flug, Liste nach Gehdistanz | ✅ |
| 5d | Zug + Luzern als Regionen mit Datenquellen (Live-Belegung wartet auf Zustimmung der Betreiber) | ✅ |
| 5e | Tarife mit „Stand vom“ und Quelle, Admin-Pflege, offene Daten Zug | ✅ |
| 6 | Buchung + Stripe PaymentSheet + Webhooks + Jobs (Verfall/Abschluss/Auszahlung), Storno/Refund, Anfrage-Buchungen, Verlängern, Erfolgs-Animation, Treueprogramm (5 Stufen, Event-Vorkauf), Stripe Connect Express, lokale Erinnerung vor Ende | ✅ |
| 6b | Pendler-Abo, Freunde werben, „Platz besetzt“-Knopf, Preisvorschlag für Vermieter, Nochmals buchen | offen |
| 7a | Favoriten (Herz-Pins, nie geclustert, Filter, Liste), Bewertungen (Parkhäuser: 1 pro Nutzer; private Plätze: nur nach Buchung), Melden, Admin-Ausblenden, Konto-Übersicht | ✅ |
| 7b | Push (Server), Vermieter-Umsatz-Dashboard | offen |
| 8 | Hardening: Sentry, E2E-Tests, TestFlight/Play Internal | offen |

## Offene Punkte vor Launch

- Bundle-ID `ch.parkly.app` bestätigen; Domain parkly.ch / Markenprüfung (IGE Swissreg)
- AGB, Datenschutzerklärung, Vermieter-Bedingungen (URLs in `src/config/app.ts`)
- Supabase-Projekt (Region EU/CH), E-Mail-Bestätigung aktivieren, eigener SMTP-Absender
- Stripe-Konto (CH) mit Connect; TWINT-Verfügbarkeit für Connect prüfen
