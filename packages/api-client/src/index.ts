import {
  bookingListSchema,
  bookingSchema,
  cancelPreviewSchema,
  createBookingResponseSchema,
  eventListSchema,
  eventSchema,
  extendResponseSchema,
  loyaltySchema,
  onboardingLinkSchema,
  paymentConfigSchema,
  payoutAccountSchema,
  quoteSchema,
  twintPayResponseSchema,
  type Booking,
  type BookingQuote,
  type CreateBookingInput,
  type CreateBookingResponse,
  type CreateEventInput,
  type ExtendResponse,
  type Loyalty,
  type ParkEvent,
  type PaymentConfig,
  type PayoutAccount,
  hostFeeSchema,
  hostSpotListSchema,
  hostSpotSchema,
  imageUploadTicketSchema,
  spotDetailSchema,
  spotImageSchema,
  type CreateSpotInput,
  type FacilityTariffsInput,
  type HostFee,
  type HostSpot,
  type HostSpotListItem,
  type ImageUploadTicket,
  type ReorderImagesInput,
  type RequestImageUploadInput,
  type SpotAvailabilityInput,
  type SpotDetail,
  type SpotImage,
  type UpdateSpotInput,
  routeSchema,
  type LatLng,
  type Route,
  placeSearchResponseSchema,
  type PlaceSuggestion,
  favoritesResponseSchema,
  myReviewsResponseSchema,
  reviewListSchema,
  reviewSchema,
  type FavoriteItem,
  type FavoriteTarget,
  type MyReview,
  type ReportReviewInput,
  type Review,
  type ReviewList,
  type UpsertReviewInput,
  facilityDetailSchema,
  mapResponseSchema,
  meSchema,
  nearbyResponseSchema,
  type FacilityDetail,
  type MapResponse,
  type NearbyItem,
  type ParkingKind,
  type BecomeHostInput,
  type Me,
  type Platform,
  type UpdateMeInput,
} from '@parking/shared';
import { HttpClient, type ApiClientOptions } from './client';

export { ApiError, HttpClient, type ApiClientOptions } from './client';

/** Typisierte Endpunkte, gruppiert nach Ressource (wächst mit jeder Phase). */
export function createApiClient(options: ApiClientOptions) {
  const http = new HttpClient(options);

  return {
    http,
    health: () => http.request('GET', '/health', { auth: false }),
    me: {
      get: (): Promise<Me> => http.request('GET', '/v1/me', { schema: meSchema }),
      update: (input: UpdateMeInput): Promise<Me> =>
        http.request('PATCH', '/v1/me', { body: input, schema: meSchema }),
      acceptTerms: (): Promise<Me> => http.request('POST', '/v1/me/accept-terms', { schema: meSchema }),
      becomeHost: (input: BecomeHostInput): Promise<Me> =>
        http.request('POST', '/v1/me/host', { body: input, schema: meSchema }),
      registerPushToken: (token: string, platform: Platform) =>
        http.request('POST', '/v1/me/push-tokens', { body: { token, platform } }),
      delete: () => http.request('DELETE', '/v1/me'),
    },
    map: {
      /** Pins bzw. Cluster für einen Kartenausschnitt (öffentlich, ohne Login). */
      inBounds: (
        q: {
          minLng: number;
          minLat: number;
          maxLng: number;
          maxLat: number;
          zoom: number;
          kinds?: ParkingKind[];
          favoritesOnly?: boolean;
        },
        signal?: AbortSignal,
      ): Promise<MapResponse> =>
        http.request('GET', '/v1/map', {
          signal,
          schema: mapResponseSchema,
          query: { ...q, kinds: q.kinds?.join(','), favoritesOnly: q.favoritesOnly ? 'true' : undefined },
        }),
      nearby: (q: { lat: number; lng: number; radius?: number; limit?: number; walk?: boolean }): Promise<NearbyItem[]> =>
        http
          .request('GET', '/v1/nearby', { query: { ...q, walk: q.walk ? 'true' : undefined }, schema: nearbyResponseSchema })
          .then((r) => r.items),
      facility: (id: string): Promise<FacilityDetail> =>
        http.request('GET', `/v1/facilities/${encodeURIComponent(id)}`, { schema: facilityDetailSchema }),
    },
    spots: {
      /** Öffentliche Detailseite eines privaten Parkplatzes. */
      detail: (id: string): Promise<SpotDetail> =>
        http.request('GET', `/v1/spots/${encodeURIComponent(id)}`, { schema: spotDetailSchema }),
    },
    host: {
      fee: (): Promise<HostFee> => http.request('GET', '/v1/host/fee', { schema: hostFeeSchema }),
      list: (): Promise<HostSpotListItem[]> =>
        http.request('GET', '/v1/host/spots', { schema: hostSpotListSchema }).then((r) => r.items),
      get: (id: string): Promise<HostSpot> => http.request('GET', `/v1/host/spots/${id}`, { schema: hostSpotSchema }),
      create: (input: CreateSpotInput): Promise<HostSpot> =>
        http.request('POST', '/v1/host/spots', { body: input, schema: hostSpotSchema }),
      update: (id: string, input: UpdateSpotInput): Promise<HostSpot> =>
        http.request('PATCH', `/v1/host/spots/${id}`, { body: input, schema: hostSpotSchema }),
      setAvailability: (id: string, input: SpotAvailabilityInput): Promise<HostSpot> =>
        http.request('PUT', `/v1/host/spots/${id}/availability`, { body: input, schema: hostSpotSchema }),
      publish: (id: string): Promise<HostSpot> => http.request('POST', `/v1/host/spots/${id}/publish`, { schema: hostSpotSchema }),
      pause: (id: string): Promise<HostSpot> => http.request('POST', `/v1/host/spots/${id}/pause`, { schema: hostSpotSchema }),
      remove: (id: string) => http.request('DELETE', `/v1/host/spots/${id}`),
      requestImageUpload: (id: string, input: RequestImageUploadInput): Promise<ImageUploadTicket> =>
        http.request('POST', `/v1/host/spots/${id}/images`, { body: input, schema: imageUploadTicketSchema }),
      completeImageUpload: (id: string, imageId: string): Promise<SpotImage> =>
        http.request('POST', `/v1/host/spots/${id}/images/${imageId}/complete`, { schema: spotImageSchema }),
      reorderImages: (id: string, input: ReorderImagesInput): Promise<HostSpot> =>
        http.request('PUT', `/v1/host/spots/${id}/images/order`, { body: input, schema: hostSpotSchema }),
      deleteImage: (id: string, imageId: string): Promise<HostSpot> =>
        http.request('DELETE', `/v1/host/spots/${id}/images/${imageId}`, { schema: hostSpotSchema }),
    },
    admin: {
      setTariffs: (facilityId: string, input: FacilityTariffsInput) =>
        http.request('PUT', `/v1/admin/facilities/${facilityId}/tariffs`, { body: input }),
      createEvent: (input: CreateEventInput): Promise<ParkEvent> => http.request('POST', '/v1/admin/events', { body: input, schema: eventSchema }),
    },
    payments: {
      config: (): Promise<PaymentConfig> => http.request('GET', '/v1/payments/config', { auth: false, schema: paymentConfigSchema }),
    },
    bookings: {
      /** Verbindlicher Preis vom Server (mit Anmeldung inkl. Treue-Rabatt). */
      quote: (spotId: string, startAt: string, endAt: string, signal?: AbortSignal): Promise<BookingQuote> =>
        http.request('POST', `/v1/spots/${encodeURIComponent(spotId)}/quote`, { body: { startAt, endAt }, signal, schema: quoteSchema }),
      create: (input: CreateBookingInput): Promise<CreateBookingResponse> => http.request('POST', '/v1/bookings', { body: input, schema: createBookingResponseSchema }),
      list: (): Promise<Booking[]> => http.request('GET', '/v1/bookings', { schema: bookingListSchema }).then((r) => r.items),
      get: (id: string): Promise<Booking> => http.request('GET', `/v1/bookings/${id}`, { schema: bookingSchema }),
      /** Zahlungsstatus beim Anbieter abfragen (nach dem Bezahlen). */
      sync: (id: string): Promise<Booking> => http.request('POST', `/v1/bookings/${id}/sync`, { schema: bookingSchema }),
      /** Mit TWINT bezahlen: liefert den Link zur TWINT-App (null im Testmodus = schon bezahlt). */
      twint: (id: string, returnUrl: string) => http.request('POST', `/v1/bookings/${id}/twint`, { body: { returnUrl }, schema: twintPayResponseSchema }),
      /** Nur im Testmodus (PAYMENT_PROVIDER=dev). */
      devPay: (id: string): Promise<Booking> => http.request('POST', `/v1/bookings/${id}/dev-pay`, { schema: bookingSchema }),
      cancelPreview: (id: string) => http.request('GET', `/v1/bookings/${id}/cancel-preview`, { schema: cancelPreviewSchema }),
      cancel: (id: string, reason?: string): Promise<Booking> => http.request('POST', `/v1/bookings/${id}/cancel`, { body: { reason }, schema: bookingSchema }),
      extend: (id: string, minutes: number): Promise<ExtendResponse> => http.request('POST', `/v1/bookings/${id}/extend`, { body: { minutes }, schema: extendResponseSchema }),
    },
    hostBookings: {
      list: (): Promise<Booking[]> => http.request('GET', '/v1/host/bookings', { schema: bookingListSchema }).then((r) => r.items),
      accept: (id: string): Promise<Booking> => http.request('POST', `/v1/host/bookings/${id}/accept`, { schema: bookingSchema }),
      decline: (id: string, reason?: string): Promise<Booking> => http.request('POST', `/v1/host/bookings/${id}/decline`, { body: { reason }, schema: bookingSchema }),
      cancel: (id: string, reason?: string): Promise<Booking> => http.request('POST', `/v1/host/bookings/${id}/cancel`, { body: { reason }, schema: bookingSchema }),
      payouts: (): Promise<PayoutAccount> => http.request('GET', '/v1/host/payouts', { schema: payoutAccountSchema }),
      onboardingLink: (): Promise<string> => http.request('POST', '/v1/host/payouts/onboarding', { schema: onboardingLinkSchema }).then((r) => r.url),
    },
    loyalty: {
      get: (): Promise<Loyalty> => http.request('GET', '/v1/me/loyalty', { schema: loyaltySchema }),
      events: (): Promise<ParkEvent[]> => http.request('GET', '/v1/events', { schema: eventListSchema }).then((r) => r.items),
    },
    route: {
      /** Autoroute vom Standort zum Ziel (POST, damit Koordinaten nicht in URLs landen). */
      get: (from: LatLng, to: LatLng, signal?: AbortSignal): Promise<Route> =>
        http.request('POST', '/v1/route', { body: { from, to }, signal, schema: routeSchema }),
    },
    search: {
      /** `near` (optional, gerundet ~1 km) verbessert die Reihenfolge; wird nicht gespeichert. */
      places: (q: string, signal?: AbortSignal, near?: { lat: number; lng: number } | null): Promise<PlaceSuggestion[]> =>
        http
          .request('GET', '/v1/search/places', {
            auth: false,
            signal,
            query: { q, lat: near ? Number(near.lat.toFixed(2)) : undefined, lng: near ? Number(near.lng.toFixed(2)) : undefined },
            schema: placeSearchResponseSchema,
          })
          .then((r) => r.items),
    },
    favorites: {
      list: (from?: { lat: number; lng: number }): Promise<FavoriteItem[]> =>
        http.request('GET', '/v1/favorites', { query: from, schema: favoritesResponseSchema }).then((r) => r.items),
      add: (t: FavoriteTarget) => http.request('PUT', `/v1/favorites/${t.kind}/${encodeURIComponent(t.id)}`),
      remove: (t: FavoriteTarget) => http.request('DELETE', `/v1/favorites/${t.kind}/${encodeURIComponent(t.id)}`),
    },
    reviews: {
      forFacility: (id: string, page: { limit?: number; before?: string } = {}): Promise<ReviewList> =>
        http.request('GET', `/v1/facilities/${encodeURIComponent(id)}/reviews`, { query: page, schema: reviewListSchema }),
      upsertForFacility: (id: string, input: UpsertReviewInput): Promise<Review> =>
        http.request('PUT', `/v1/facilities/${encodeURIComponent(id)}/reviews/mine`, { body: input, schema: reviewSchema }),
      deleteForFacility: (id: string) => http.request('DELETE', `/v1/facilities/${encodeURIComponent(id)}/reviews/mine`),
      mine: (): Promise<MyReview[]> =>
        http.request('GET', '/v1/me/reviews', { schema: myReviewsResponseSchema }).then((r) => r.items),
      report: (reviewId: string, input: ReportReviewInput) =>
        http.request('POST', `/v1/reviews/${encodeURIComponent(reviewId)}/report`, { body: input }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
