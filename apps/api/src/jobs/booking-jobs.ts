import type { FastifyBaseLogger } from 'fastify';
import type { BookingService } from '../services/booking-service';

/** Jede Minute: Reservierungen freigeben, Anfragen ablaufen lassen, abschliessen, auszahlen. */
export function startBookingJobs(opts: { bookings: BookingService; log: Pick<FastifyBaseLogger, 'info' | 'warn'>; intervalMs?: number }): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await opts.bookings.runJobs();
      if (r.expired || r.approvals || r.completed || r.transferred) opts.log.info(r, 'Buchungs-Jobs');
    } catch (err) {
      opts.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Buchungs-Jobs fehlgeschlagen');
    } finally {
      running = false;
    }
  };
  const id = setInterval(() => void tick(), opts.intervalMs ?? 60_000);
  void tick();
  return () => clearInterval(id);
}
