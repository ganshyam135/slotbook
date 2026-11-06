"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AvailabilityPicker, type AvailabilitySlot } from "@/components/AvailabilityPicker";

const subscribeToBrowserTimezone = () => () => {};
const getBrowserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const getServerTimezone = () => "UTC";

interface BookingManagementActionsProps {
  bookingId: string;
  token: string;
  hostSlug: string;
  eventSlug: string;
  durationMinutes: number;
  capacity: number;
  status: string;
  holdExpired: boolean;
  guestName: string | null;
  guestEmail: string | null;
}

interface SlotsResponse {
  slots: AvailabilitySlot[];
  availability: AvailabilitySlot[];
  message?: string;
}

export function BookingManagementActions({
  bookingId,
  token,
  hostSlug,
  eventSlug,
  durationMinutes,
  capacity,
  status,
  holdExpired,
  guestName: initialGuestName,
  guestEmail: initialGuestEmail,
}: BookingManagementActionsProps) {
  const router = useRouter();
  const timezone = useSyncExternalStore(
    subscribeToBrowserTimezone,
    getBrowserTimezone,
    getServerTimezone,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(status === "confirmed");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [reason, setReason] = useState("");
  const [guestName, setGuestName] = useState(initialGuestName ?? "");
  const [guestEmail, setGuestEmail] = useState(initialGuestEmail ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dateOptions = useMemo(
    () => Array.from({ length: 31 }, (_, index) =>
      DateTime.now().setZone(timezone).startOf("day").plus({ days: index }).toISODate(),
    ).filter((date): date is string => date !== null),
    [timezone],
  );

  useEffect(() => {
    if (status !== "confirmed") return;
    const controller = new AbortController();
    const from = new Date();
    const to = DateTime.utc().plus({ days: 30 }).toJSDate();
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      tz: timezone,
    });

    fetch(`/api/hosts/${hostSlug}/events/${eventSlug}/slots?${params}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        const payload = await response.json() as SlotsResponse;
        if (!response.ok) throw new Error(payload.message ?? "Unable to load available times.");
        const options = payload.availability ?? payload.slots.map((slot) => ({ ...slot, available: true }));
        setSlots(options);
        setSelectedSlot(null);
        setSelectedDate(payload.slots[0]?.guestDay ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "Unable to load available times.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSlots(false);
      });

    return () => controller.abort();
  }, [availabilityVersion, eventSlug, hostSlug, status, timezone, token]);

  async function submit(path: string, body: Record<string, string>) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        if (path.endsWith("/reschedule") && response.status === 409) {
          setSelectedSlot(null);
          setLoadError(null);
          setLoadingSlots(true);
          setAvailabilityVersion((version) => version + 1);
        }
        throw new Error(payload.message ?? "Request failed.");
      }
      setMessage(payload.message ?? "Booking updated.");
      if (path.endsWith("/reschedule")) {
        setLoadError(null);
        setLoadingSlots(true);
        setAvailabilityVersion((version) => version + 1);
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "held") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(`/api/holds/${encodeURIComponent(bookingId)}/confirm`, { guestName, guestEmail });
        }}
        className="mt-6 space-y-3"
      >
        <p className="text-sm text-slate-600">
          {holdExpired ? "This hold has expired." : "This time is held for up to five minutes."}
        </p>
        {!holdExpired ? (
          <>
            <label className="block text-sm font-medium text-slate-700">
              Full name
              <input
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                required
                minLength={2}
                maxLength={120}
                className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Email address
              <input
                type="email"
                value={guestEmail}
                onChange={(event) => setGuestEmail(event.target.value)}
                required
                maxLength={254}
                className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Confirming..." : "Confirm booking"}
            </button>
          </>
        ) : null}
        {message ? <p role="status" className="text-sm text-slate-600">{message}</p> : null}
      </form>
    );
  }

  if (status !== "confirmed") {
    return (
      <>
        <p className="mt-6 text-sm text-slate-600">This booking is {status} and can no longer be changed.</p>
        {message ? <p role="status" className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </>
    );
  }

  const selectedAppointment = slots.find((slot) => slot.start === selectedSlot);
  const selectedDateTime = selectedAppointment
    ? DateTime.fromISO(selectedAppointment.start, { zone: "utc" })
      .setZone(timezone)
      .toLocaleString({
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="mt-6 space-y-6 border-t border-slate-200 pt-6">
      <section aria-labelledby="reschedule-heading" className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 id="reschedule-heading" className="text-lg font-semibold text-slate-900">Reschedule appointment</h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose an available date and time. Times are shown in {timezone} ({durationMinutes} minutes).
        </p>
        <div className="mt-4">
          <AvailabilityPicker
            dateOptions={dateOptions}
            timezone={timezone}
            slots={slots}
            selectedDate={selectedDate}
            selectedSlot={selectedSlot}
            capacity={capacity}
            loading={loadingSlots}
            disabled={busy}
            loadError={loadError}
            emptyMessage="No rescheduling availability in the next 30 days."
            onDateChange={(date) => {
              setSelectedDate(date);
              setSelectedSlot(null);
            }}
            onSlotChange={setSelectedSlot}
          />
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-medium text-slate-900">Proposed appointment</p>
          <p className="mt-1">{selectedDateTime ?? "Select an available time"}</p>
          <p className="mt-1 text-xs text-slate-600">{durationMinutes} minutes · Capacity {capacity}</p>
        </div>
        <button
          type="button"
          disabled={busy || loadingSlots || !selectedSlot}
          onClick={() => {
            if (selectedSlot) {
              void submit(`/api/bookings/${encodeURIComponent(token)}/reschedule`, {
                newStart: selectedSlot,
              });
            }
          }}
          className="mt-4 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "Rescheduling..." : "Reschedule appointment"}
        </button>
      </section>

      <section aria-labelledby="cancel-heading" className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
        <h2 id="cancel-heading" className="text-lg font-semibold text-slate-900">Cancel appointment</h2>
        <p className="mt-1 text-sm text-slate-600">This action releases your reserved time.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(`/api/bookings/${encodeURIComponent(token)}/cancel`, { reason });
          }}
          className="mt-4 space-y-3"
        >
          <label className="block text-sm font-medium text-slate-700">
            Cancellation reason
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={2}
              maxLength={500}
              className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            Cancel booking
          </button>
        </form>
      </section>
      {message ? <p role="status" className="text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}
