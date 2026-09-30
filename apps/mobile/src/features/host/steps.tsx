import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import {
  ACCESS_METHODS,
  AMENITIES,
  CANCELLATION_POLICIES,
  EV_CONNECTORS,
  IMAGE_KINDS,
  SPOT_MAX_IMAGES,
  SPOT_MIN_IMAGES,
  SPOT_TYPES,
  VEHICLE_TYPES,
  type CreateSpotInput,
  type HostSpot,
  type PlaceSuggestion,
  type SpotAddress,
  type UpdateSpotInput,
} from '@parking/shared';
import { useLocation } from '@/features/location/LocationProvider';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { mediaUrl } from '@/lib/media';
import { Banner, Button, Checkbox, colors, radius, spacing, Text, TextField, typography } from '@/ui';
import { DEFAULT_DAY, daysToRules, parseTime, PRESETS, rulesToDays, type DayEdit } from './availability';
import { Chips, NumberInput, PriceRow, Section, SwitchRow } from './components';
import {
  ACCESS_LABEL,
  AMENITY_LABEL,
  CANCELLATION_LABEL,
  EV_LABEL,
  hhmm,
  IMAGE_KIND_LABEL,
  ISSUE_LABEL,
  minutesLabel,
  SPOT_TYPE_LABEL,
  VEHICLE_LABEL,
  WEEKDAYS,
} from './labels';
import { LocationPicker } from './LocationPicker';
import { usePhotoUploads } from './upload';

/** Jeder Schritt hinterlegt hier seine Speicherfunktion; der Assistent ruft sie bei "Weiter" auf. */
export type SubmitRef = MutableRefObject<(() => Promise<boolean>) | null>;

export interface StepProps {
  spot: HostSpot | null;
  submit: SubmitRef;
  onSaved: (spot: HostSpot) => void;
  goTo?: (step: number) => void;
}

const opts = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((v) => ({ value: v, label: labels[v] }));

/** Speichern mit einheitlicher Fehleranzeige. */
function useSaver(onSaved: (s: HostSpot) => void) {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<HostSpot>) => {
    setError(null);
    try {
      onSaved(await fn());
      return true;
    } catch (e) {
      setError(userMessage(e));
      return false;
    }
  };
  return { error, setError, run };
}

// ─── 1 Standort ───────────────────────────────────────────────────────────

/** "Baarerstrasse 14 6300 Zug" -> Adressfelder */
export function parseSwissAddress(label: string): SpotAddress | null {
  const m = label.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\.\d+)?)\s+(\d{4})\s+(.+)$/);
  if (m) return { street: m[1]!, houseNumber: m[2]!, postalCode: m[3]!, city: m[4]! };
  const n = label.match(/^(.+?)\s+(\d{4})\s+(.+)$/);
  return n ? { street: n[1]!, houseNumber: null, postalCode: n[2]!, city: n[3]! } : null;
}

export function LocationStep({ spot, submit, onSaved, create }: StepProps & { create: (input: CreateSpotInput) => Promise<HostSpot> }) {
  const { coords } = useLocation();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [address, setAddress] = useState<SpotAddress>(spot?.address ?? { street: '', houseNumber: null, postalCode: '', city: '' });
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(spot?.location ?? null);
  const [floor, setFloor] = useState(spot?.floor ?? '');
  const [spotNumber, setSpotNumber] = useState(spot?.spotNumber ?? '');
  const [spotType, setSpotType] = useState(spot?.spotType ?? 'OUTDOOR');
  const [isCovered, setCovered] = useState(spot?.isCovered ?? false);
  const saver = useSaver(onSaved);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const results = useQuery({
    queryKey: ['address-search', debounced],
    queryFn: ({ signal }) => api.search.places(debounced, signal, coords),
    enabled: debounced.length >= 3,
    select: (items) => items.filter((i) => i.type === 'ADDRESS').slice(0, 5),
  });

  const pick = (s: PlaceSuggestion) => {
    const a = parseSwissAddress(s.label);
    if (a) setAddress(a);
    setLocation({ lat: s.lat, lng: s.lng });
    setQuery('');
    setDebounced('');
  };

  submit.current = async () => {
    if (!location) {
      saver.setError('Bitte suche die Adresse deines Parkplatzes.');
      return false;
    }
    if (!address.street || !/^\d{4}$/.test(address.postalCode) || !address.city) {
      saver.setError('Bitte ergänze Strasse, PLZ und Ort.');
      return false;
    }
    const fields = {
      address: { ...address, houseNumber: address.houseNumber?.trim() || null },
      location,
      floor: floor.trim() || null,
      spotNumber: spotNumber.trim() || null,
      spotType,
      isCovered: spotType === 'OUTDOOR' ? isCovered : true,
    };
    return saver.run(() => (spot ? api.host.update(spot.id, fields) : create(fields)));
  };

  return (
    <View>
      {saver.error ? <Banner>{saver.error}</Banner> : null}
      <Section title="Adresse" hint="Die genaue Adresse sehen Mieter erst nach der Buchung. Auf der Karte erscheint der Platz nur ungefähr.">
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.accent} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Strasse und Hausnummer, Ort"
            placeholderTextColor={colors.inkTertiary}
            style={styles.searchInput}
            autoCorrect={false}
            accessibilityLabel="Adresse suchen"
          />
          {results.isFetching ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </View>
        {results.data?.length ? (
          <View style={styles.results}>
            {results.data.map((r) => (
              <Pressable key={r.id} onPress={() => pick(r)} style={styles.result} accessibilityRole="button">
                <Ionicons name="location-outline" size={18} color={colors.accent} />
                <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                  {r.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {location ? (
          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            <LocationPicker value={location} onChange={setLocation} />
            <View style={styles.row2}>
              <View style={{ flex: 3 }}>
                <TextField label="Strasse" value={address.street} onChangeText={(v) => setAddress({ ...address, street: v })} />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label="Nr." value={address.houseNumber ?? ''} onChangeText={(v) => setAddress({ ...address, houseNumber: v })} />
              </View>
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <TextField label="PLZ" value={address.postalCode} keyboardType="number-pad" maxLength={4} onChangeText={(v) => setAddress({ ...address, postalCode: v })} />
              </View>
              <View style={{ flex: 2 }}>
                <TextField label="Ort" value={address.city} onChangeText={(v) => setAddress({ ...address, city: v })} />
              </View>
            </View>
          </View>
        ) : null}
      </Section>
      <Section title="Art des Parkplatzes">
        <Chips options={opts(SPOT_TYPES, SPOT_TYPE_LABEL)} value={[spotType]} onChange={(v) => setSpotType(v[0]!)} />
        {spotType === 'OUTDOOR' ? <SwitchRow label="Überdacht" value={isCovered} onChange={setCovered} /> : null}
      </Section>
      <Section title="Stockwerk und Platznummer" hint="Freiwillig. Die Platznummer sehen Mieter erst nach der Buchung.">
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <TextField label="Stockwerk" placeholder="z. B. -2" value={floor} onChangeText={setFloor} maxLength={10} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="Platznummer" placeholder="z. B. 17" value={spotNumber} onChangeText={setSpotNumber} maxLength={12} />
          </View>
        </View>
      </Section>
    </View>
  );
}

// ─── 2 Fahrzeuge und Ausstattung ──────────────────────────────────────────

export function VehicleStep({ spot, submit, onSaved }: StepProps) {
  const s = spot!;
  const [vehicleTypes, setVehicles] = useState(s.vehicleTypes);
  const [len, setLen] = useState(s.maxLengthCm);
  const [wid, setWid] = useState(s.maxWidthCm);
  const [hei, setHei] = useState(s.maxHeightCm);
  const [amenities, setAmenities] = useState(s.amenities);
  const [ev, setEv] = useState(s.hasEvCharging);
  const [connector, setConnector] = useState(s.evConnector ?? 'TYPE2');
  const [kw, setKw] = useState(s.evPowerKw);
  const saver = useSaver(onSaved);

  submit.current = () => {
    if (!vehicleTypes.length) {
      saver.setError('Wähle mindestens einen Fahrzeugtyp.');
      return Promise.resolve(false);
    }
    const input: UpdateSpotInput = {
      vehicleTypes,
      maxLengthCm: len,
      maxWidthCm: wid,
      maxHeightCm: hei,
      amenities,
      hasEvCharging: ev,
      evConnector: ev ? connector : null,
      evPowerKw: ev ? kw : null,
    };
    return saver.run(() => api.host.update(s.id, input));
  };

  return (
    <View>
      {saver.error ? <Banner>{saver.error}</Banner> : null}
      <Section title="Welche Fahrzeuge passen?">
        <Chips multiple options={opts(VEHICLE_TYPES, VEHICLE_LABEL)} value={vehicleTypes} onChange={setVehicles} />
      </Section>
      <Section title="Maximale Masse" hint="Freiwillig, hilft Mietern mit grossen Autos.">
        <View style={{ gap: spacing.sm }}>
          <NumberInput value={len} onChange={setLen} unit="cm Länge" placeholder="z. B. 500" accessibilityLabel="Maximale Länge" />
          <NumberInput value={wid} onChange={setWid} unit="cm Breite" placeholder="z. B. 250" accessibilityLabel="Maximale Breite" />
          <NumberInput value={hei} onChange={setHei} unit="cm Höhe" placeholder="z. B. 200" accessibilityLabel="Maximale Höhe" />
        </View>
      </Section>
      <Section title="Ausstattung">
        <Chips multiple options={opts(AMENITIES, AMENITY_LABEL)} value={amenities} onChange={setAmenities} />
      </Section>
      <Section title="Elektroauto laden">
        <SwitchRow label="Ladestation vorhanden" value={ev} onChange={setEv} />
        {ev ? (
          <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
            <Chips options={opts(EV_CONNECTORS, EV_LABEL)} value={[connector]} onChange={(v) => setConnector(v[0]!)} />
            <NumberInput value={kw} onChange={setKw} unit="kW Ladeleistung" placeholder="z. B. 11" accessibilityLabel="Ladeleistung" decimals />
          </View>
        ) : null}
      </Section>
    </View>
  );
}

// ─── 3 Zugang und Zeiten ──────────────────────────────────────────────────

function TimeField({ value, onChange, label }: { value: number; onChange: (m: number) => void; label: string }) {
  const [text, setText] = useState(hhmm(value));
  useEffect(() => setText(hhmm(value)), [value]);
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={() => {
        const m = parseTime(text);
        if (m === null) setText(hhmm(value));
        else onChange(m % 1440);
      }}
      keyboardType="numbers-and-punctuation"
      style={styles.time}
      accessibilityLabel={label}
      maxLength={5}
    />
  );
}

export function AccessStep({ spot, submit, onSaved }: StepProps) {
  const s = spot!;
  const [method, setMethod] = useState(s.accessMethod);
  const [always, setAlways] = useState(s.access24h || s.availability.length === 0);
  const [days, setDays] = useState<DayEdit[]>(s.availability.length ? rulesToDays(s.availability) : PRESETS[0]!.days);
  const [instructions, setInstructions] = useState(s.accessInstructions ?? '');
  const saver = useSaver(onSaved);

  submit.current = async () => {
    const rules = always ? [] : daysToRules(days);
    if (!always && rules.length === 0) {
      saver.setError('Wähle mindestens einen Tag oder "Immer verfügbar".');
      return false;
    }
    return saver.run(async () => {
      await api.host.update(s.id, { accessMethod: method, accessInstructions: instructions.trim() || null });
      return api.host.setAvailability(s.id, { access24h: always, rules });
    });
  };

  return (
    <View>
      {saver.error ? <Banner>{saver.error}</Banner> : null}
      <Section title="Wie kommt man hinein?">
        <Chips options={opts(ACCESS_METHODS, ACCESS_LABEL)} value={[method]} onChange={(v) => setMethod(v[0]!)} />
      </Section>
      <Section title="Wann ist der Platz buchbar?">
        <SwitchRow label="Immer verfügbar (24/7)" value={always} onChange={setAlways} />
        {!always ? (
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={styles.presets}>
              {PRESETS.map((p) => (
                <Pressable key={p.label} onPress={() => setDays(p.days.map((d) => ({ ...d })))} style={styles.preset} accessibilityRole="button">
                  <Text variant="captionStrong" style={{ color: colors.accent }}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {days.map((d, i) => (
              <View key={WEEKDAYS[i]} style={styles.dayRow}>
                <Pressable
                  onPress={() => setDays(days.map((x, j) => (j === i ? { ...(x.enabled ? x : { ...DEFAULT_DAY }), enabled: !x.enabled } : x)))}
                  style={[styles.day, d.enabled && styles.dayOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: d.enabled }}
                >
                  <Text variant="captionStrong" style={{ color: d.enabled ? colors.onPrimary : colors.inkSecondary }}>
                    {WEEKDAYS[i]}
                  </Text>
                </Pressable>
                {d.enabled ? (
                  <>
                    <TimeField label={`${WEEKDAYS[i]} von`} value={d.from} onChange={(m) => setDays(days.map((x, j) => (j === i ? { ...x, from: m } : x)))} />
                    <Text variant="callout" tone="secondary">
                      bis
                    </Text>
                    <TimeField label={`${WEEKDAYS[i]} bis`} value={d.to} onChange={(m) => setDays(days.map((x, j) => (j === i ? { ...x, to: m } : x)))} />
                    <Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
                      {d.to === d.from ? 'ganzer Tag' : d.to < d.from ? 'über Nacht' : ''}
                    </Text>
                  </>
                ) : (
                  <Text variant="callout" tone="tertiary">
                    nicht verfügbar
                  </Text>
                )}
              </View>
            ))}
          </View>
        ) : null}
      </Section>
      <Section title="Zugangsinfos für Mieter" hint="Nur für Mieter mit bestätigter Buchung sichtbar, z. B. Code, wo der Schlüssel liegt, Einfahrt.">
        <TextField
          label="Zugangsinfos"
          value={instructions}
          onChangeText={setInstructions}
          multiline
          maxLength={1000}
          style={{ minHeight: 90, textAlignVertical: 'top' }}
          placeholder="z. B. Einfahrt über die Rampe rechts, Tor öffnet mit Fernbedienung im Briefkasten 3"
        />
      </Section>
    </View>
  );
}

// ─── 4 Beschreibung ───────────────────────────────────────────────────────

export function DescriptionStep({ spot, submit, onSaved }: StepProps) {
  const s = spot!;
  const [title, setTitle] = useState(s.title);
  const [description, setDescription] = useState(s.description);
  const [rules, setRules] = useState(s.rules ?? '');
  const saver = useSaver(onSaved);

  submit.current = async () => {
    if (title.trim().length < 5) {
      saver.setError('Der Titel braucht mindestens 5 Zeichen.');
      return false;
    }
    return saver.run(() => api.host.update(s.id, { title: title.trim(), description: description.trim(), rules: rules.trim() || null }));
  };

  return (
    <View style={{ gap: spacing.lg }}>
      {saver.error ? <Banner>{saver.error}</Banner> : null}
      <TextField label="Titel" value={title} onChangeText={setTitle} maxLength={80} hint="z. B. Tiefgaragenplatz beim Bahnhof Zug" />
      <TextField
        label="Beschreibung"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
        style={{ minHeight: 120, textAlignVertical: 'top' }}
        placeholder="Was macht deinen Platz praktisch? Nähe zu Bahnhof, Einkaufen, Arbeitsplätzen …"
      />
      <TextField
        label="Regeln (freiwillig)"
        value={rules}
        onChangeText={setRules}
        multiline
        maxLength={1000}
        style={{ minHeight: 80, textAlignVertical: 'top' }}
        placeholder="z. B. Keine Anhänger, Motor nicht laufen lassen"
      />
    </View>
  );
}

// ─── 5 Preise und Buchungsregeln ──────────────────────────────────────────

const MIN_OPTIONS = [30, 60, 120, 1440];
const MAX_OPTIONS = [1440, 7 * 1440, 30 * 1440, 90 * 1440, 365 * 1440];
const LEAD_OPTIONS = [0, 30, 60, 180, 1440];

export function PriceStep({ spot, submit, onSaved, feeBps }: StepProps & { feeBps: number }) {
  const s = spot!;
  const [prices, setPrices] = useState(s.prices);
  const [minD, setMin] = useState(s.minDurationMinutes);
  const [maxD, setMax] = useState(s.maxDurationMinutes);
  const [lead, setLead] = useState(s.leadTimeMinutes);
  const [instant, setInstant] = useState(s.instantBook);
  const [policy, setPolicy] = useState(s.cancellationPolicy);
  const saver = useSaver(onSaved);

  submit.current = async () => {
    if (Object.values(prices).every((v) => v === null)) {
      saver.setError('Gib mindestens einen Preis an.');
      return false;
    }
    if (maxD < minD) {
      saver.setError('Die Höchstdauer muss mindestens so lang sein wie die Mindestdauer.');
      return false;
    }
    return saver.run(() =>
      api.host.update(s.id, { prices, minDurationMinutes: minD, maxDurationMinutes: maxD, leadTimeMinutes: lead, instantBook: instant, cancellationPolicy: policy }),
    );
  };

  const withCurrent = (options: number[], v: number) => (options.includes(v) ? options : [...options, v].sort((a, b) => a - b));

  return (
    <View>
      {saver.error ? <Banner>{saver.error}</Banner> : null}
      <Section title="Preise" hint={`Leer lassen, was du nicht anbietest. Plattformgebühr: ${feeBps / 100} %.`}>
        <PriceRow label="Pro Stunde" value={prices.hourly} onChange={(v) => setPrices({ ...prices, hourly: v })} feeBps={feeBps} />
        <PriceRow label="Pro Tag" value={prices.daily} onChange={(v) => setPrices({ ...prices, daily: v })} feeBps={feeBps} />
        <PriceRow label="Pro Woche" value={prices.weekly} onChange={(v) => setPrices({ ...prices, weekly: v })} feeBps={feeBps} />
        <PriceRow label="Pro Monat" value={prices.monthly} onChange={(v) => setPrices({ ...prices, monthly: v })} feeBps={feeBps} />
      </Section>
      <Section title="Mindestdauer">
        <Chips options={withCurrent(MIN_OPTIONS, minD).map((m) => ({ value: String(m), label: minutesLabel(m) }))} value={[String(minD)]} onChange={(v) => setMin(Number(v[0]))} />
      </Section>
      <Section title="Höchstdauer">
        <Chips options={withCurrent(MAX_OPTIONS, maxD).map((m) => ({ value: String(m), label: minutesLabel(m) }))} value={[String(maxD)]} onChange={(v) => setMax(Number(v[0]))} />
      </Section>
      <Section title="Vorlaufzeit" hint="So lange vor Beginn muss spätestens gebucht werden.">
        <Chips
          options={withCurrent(LEAD_OPTIONS, lead).map((m) => ({ value: String(m), label: m === 0 ? 'Sofort' : minutesLabel(m) }))}
          value={[String(lead)]}
          onChange={(v) => setLead(Number(v[0]))}
        />
      </Section>
      <Section title="Buchungsart">
        <Chips
          options={[
            { value: 'instant', label: 'Sofort buchbar' },
            { value: 'request', label: 'Auf Anfrage' },
          ]}
          value={[instant ? 'instant' : 'request']}
          onChange={(v) => setInstant(v[0] === 'instant')}
        />
        <Text variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
          {instant ? 'Mieter buchen und bezahlen direkt.' : 'Du bestätigst jede Buchung selbst innerhalb von 24 Stunden.'}
        </Text>
      </Section>
      <Section title="Stornobedingungen">
        <View style={{ gap: spacing.sm }}>
          {CANCELLATION_POLICIES.map((p) => (
            <Pressable key={p} onPress={() => setPolicy(p)} style={[styles.policy, policy === p && styles.policyOn]} accessibilityRole="radio" accessibilityState={{ selected: policy === p }}>
              <Ionicons name={policy === p ? 'radio-button-on' : 'radio-button-off'} size={20} color={policy === p ? colors.accent : colors.inkTertiary} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{CANCELLATION_LABEL[p].title}</Text>
                <Text variant="caption" tone="secondary">
                  {CANCELLATION_LABEL[p].text}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Section>
    </View>
  );
}

// ─── 6 Fotos ──────────────────────────────────────────────────────────────

export function PhotoStep({ spot, submit, onSaved }: StepProps) {
  const s = spot!;
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploads = usePhotoUploads(s.id, onSaved);
  const ready = s.images.filter((i) => i.status === 'READY');
  const remaining = SPOT_MAX_IMAGES - ready.length - uploads.pending.filter((p) => p.status !== 'error').length;

  submit.current = async () => {
    if (uploads.pending.some((p) => p.status !== 'error')) {
      setError('Bitte warte, bis alle Fotos hochgeladen sind.');
      return false;
    }
    if (ready.length < SPOT_MIN_IMAGES) {
      setError(`Lade mindestens ${SPOT_MIN_IMAGES} Fotos hoch.`);
      return false;
    }
    return true;
  };

  const save = async (items: { id: string; kind: (typeof IMAGE_KINDS)[number] }[]) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.host.reorderImages(s.id, { items }));
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const order = ready.map((i) => ({ id: i.id, kind: i.kind }));
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...order];
    const [item] = next.splice(idx, 1);
    next.splice(Math.max(0, Math.min(next.length, idx + dir)), 0, item!);
    void save(next);
  };
  const makeCover = (idx: number) => {
    const next = [...order];
    const [item] = next.splice(idx, 1);
    void save([item!, ...next]);
  };
  const setKind = (idx: number, kind: (typeof IMAGE_KINDS)[number]) => void save(order.map((o, j) => (j === idx ? { ...o, kind } : o)));
  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.host.deleteImage(s.id, id));
      setSelected(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const add = (source: 'library' | 'camera') => {
    setError(null);
    uploads.add(source, remaining).catch((e: unknown) => setError(e instanceof Error ? e.message : userMessage(e)));
  };

  return (
    <View>
      {error ? <Banner>{error}</Banner> : null}
      <Text variant="callout" tone="secondary" style={{ marginBottom: spacing.md }}>
        {ready.length} von {SPOT_MAX_IMAGES} Fotos · mindestens {SPOT_MIN_IMAGES}. Das erste Foto ist das Titelbild. Tippe ein Foto an, um es zu verschieben, zu benennen oder zu löschen.
      </Text>
      <View style={styles.grid}>
        {ready.map((img, idx) => {
          const on = selected === img.id;
          return (
            <Pressable key={img.id} onPress={() => setSelected(on ? null : img.id)} style={[styles.tile, on && styles.tileOn]} accessibilityLabel={`Foto ${idx + 1}`}>
              {img.url ? <Image source={{ uri: mediaUrl(img.url) }} style={styles.photo} /> : <View style={[styles.photo, { backgroundColor: colors.surface }]} />}
              {idx === 0 ? (
                <View style={styles.cover}>
                  <Text variant="micro" style={{ color: colors.onPrimary }}>
                    TITELBILD
                  </Text>
                </View>
              ) : null}
              <View style={styles.kind}>
                <Text variant="micro">{IMAGE_KIND_LABEL[img.kind]}</Text>
              </View>
            </Pressable>
          );
        })}
        {uploads.pending.map((p) => (
          <View key={p.localId} style={styles.tile}>
            <Image source={{ uri: p.uri }} style={[styles.photo, { opacity: 0.5 }]} />
            <View style={styles.overlay}>
              {p.status === 'error' ? (
                <View style={{ alignItems: 'center', gap: 4, padding: 4 }}>
                  <Text variant="micro" tone="danger" numberOfLines={3} style={{ textAlign: 'center' }}>
                    {p.error}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Pressable onPress={() => uploads.retry(p.localId)} hitSlop={8} accessibilityLabel="Erneut versuchen">
                      <Ionicons name="refresh" size={20} color={colors.accent} />
                    </Pressable>
                    <Pressable onPress={() => uploads.dismiss(p.localId)} hitSlop={8} accessibilityLabel="Verwerfen">
                      <Ionicons name="close" size={20} color={colors.inkSecondary} />
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ width: '80%', gap: 4 }}>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${Math.round(p.progress * 100)}%` }]} />
                  </View>
                  <Text variant="micro" tone="secondary" style={{ textAlign: 'center' }}>
                    {p.status === 'processing' ? 'Verkleinern …' : p.status === 'finishing' ? 'Prüfen …' : `${Math.round(p.progress * 100)} %`}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ))}
      </View>

      {selected ? (() => {
        const idx = ready.findIndex((i) => i.id === selected);
        if (idx < 0) return null;
        return (
          <View style={styles.editor}>
            <Text variant="captionStrong" tone="secondary">
              Was zeigt Foto {idx + 1}?
            </Text>
            <Chips options={opts(IMAGE_KINDS, IMAGE_KIND_LABEL)} value={[ready[idx]!.kind]} onChange={(v) => setKind(idx, v[0]!)} />
            <View style={styles.editorActions}>
              <Button title="Nach vorne" size="md" variant="secondary" fullWidth={false} icon="arrow-back" disabled={idx === 0 || busy} onPress={() => move(idx, -1)} />
              <Button title="Nach hinten" size="md" variant="secondary" fullWidth={false} icon="arrow-forward" disabled={idx === ready.length - 1 || busy} onPress={() => move(idx, 1)} />
              {idx > 0 ? <Button title="Als Titelbild" size="md" variant="secondary" fullWidth={false} icon="star-outline" disabled={busy} onPress={() => makeCover(idx)} /> : null}
              <Button title="Löschen" size="md" variant="danger" fullWidth={false} icon="trash-outline" disabled={busy} onPress={() => void remove(selected)} />
            </View>
          </View>
        );
      })() : null}

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
        <Button title="Aus Fotos wählen" icon="images-outline" variant="secondary" style={{ flex: 1 }} disabled={remaining <= 0} onPress={() => add('library')} />
        <Button title="Kamera" icon="camera-outline" variant="secondary" style={{ flex: 1 }} disabled={remaining <= 0} onPress={() => add('camera')} />
      </View>
      <Text variant="caption" tone="tertiary" style={{ marginTop: spacing.md }}>
        Fotos werden vor dem Hochladen verkleinert; Standort und Kameradaten im Foto werden entfernt.
      </Text>
    </View>
  );
}

// ─── 7 Prüfen und veröffentlichen ─────────────────────────────────────────

export function ReviewStep({ spot, submit, onSaved, goTo, feeBps }: StepProps & { feeBps: number }) {
  const s = spot!;
  const [rights, setRights] = useState(s.rightsConfirmed);
  const saver = useSaver(onSaved);
  const initial = useRef(s.rightsConfirmed);

  submit.current = async () => {
    if (!rights) {
      saver.setError('Bitte bestätige, dass du den Platz vermieten darfst.');
      return false;
    }
    return saver.run(async () => {
      if (!initial.current) await api.host.update(s.id, { rightsConfirmed: true });
      return api.host.publish(s.id);
    });
  };

  const issues = s.publishIssues.filter((i) => i !== 'RIGHTS');
  const stepOf: Record<string, number> = { TITLE: 3, PRICE: 4, DURATION: 4, IMAGES: 5, AVAILABILITY: 2 };
  const cover = s.images.find((i) => i.status === 'READY');

  return (
    <View style={{ gap: spacing.lg }}>
      {saver.error ? <Banner>{saver.error}</Banner> : null}
      <View style={styles.summary}>
        {cover?.url ? <Image source={{ uri: mediaUrl(cover.url) }} style={styles.summaryPhoto} /> : null}
        <View style={{ padding: spacing.lg, gap: 4 }}>
          <Text variant="headline">{s.title}</Text>
          <Text variant="callout" tone="secondary">
            {SPOT_TYPE_LABEL[s.spotType]} · {s.address.street} {s.address.houseNumber ?? ''}, {s.address.postalCode} {s.address.city}
          </Text>
          <Text variant="callout" tone="secondary">
            {[
              s.prices.hourly && `CHF ${(s.prices.hourly / 100).toFixed(2)}/Std.`,
              s.prices.daily && `CHF ${(s.prices.daily / 100).toFixed(2)}/Tag`,
              s.prices.weekly && `CHF ${(s.prices.weekly / 100).toFixed(2)}/Woche`,
              s.prices.monthly && `CHF ${(s.prices.monthly / 100).toFixed(2)}/Monat`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Noch kein Preis'}
          </Text>
          <Text variant="caption" tone="tertiary">
            Plattformgebühr {feeBps / 100} % · {s.access24h ? 'immer verfügbar' : `${s.availability.length} Zeitfenster pro Woche`}
          </Text>
        </View>
      </View>

      {issues.length ? (
        <View style={styles.issues}>
          <Text variant="bodyStrong">Noch offen</Text>
          {issues.map((i) => (
            <Pressable key={i} style={styles.issue} onPress={() => goTo?.(stepOf[i] ?? 0)} accessibilityRole="button">
              <Ionicons name="alert-circle" size={18} color={colors.warning} />
              <Text variant="callout" style={{ flex: 1 }}>
                {ISSUE_LABEL[i]}
              </Text>
              <Text variant="captionStrong" style={{ color: colors.accent }}>
                Ergänzen
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Banner tone="success">Alles bereit zum Veröffentlichen.</Banner>
      )}

      <Checkbox
        checked={rights}
        onChange={setRights}
        label="Ich bin berechtigt, diesen Parkplatz zu vermieten: als Eigentümer oder mit Zustimmung meines Vermieters bzw. der Verwaltung."
      />

      <View style={styles.stripe}>
        <Ionicons name="wallet-outline" size={22} color={colors.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Auszahlungen</Text>
          <Text variant="caption" tone="secondary">
            Das Konto für Auszahlungen (Stripe) richtest du ein, sobald Buchungen möglich sind. Veröffentlichen kannst du schon jetzt.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing.sm },
  results: { marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  result: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row2: { flexDirection: 'row', gap: spacing.md },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preset: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  day: { width: 44, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  dayOn: { backgroundColor: colors.primary },
  time: {
    width: 70,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 6,
    textAlign: 'center',
    ...typography.body,
    color: colors.ink,
  },
  policy: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  policyOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '31.5%', aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 2, borderColor: 'transparent' },
  tileOn: { borderColor: colors.accent },
  photo: { width: '100%', height: '100%' },
  cover: { position: 'absolute', left: 4, top: 4, backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  kind: { position: 'absolute', left: 4, bottom: 4, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.8)', overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.accent },
  editor: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.md },
  editorActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summary: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  summaryPhoto: { width: '100%', height: 160 },
  issues: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.warningSoft },
  issue: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
  stripe: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
});
