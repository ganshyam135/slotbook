"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useRef, useState } from "react";

interface BookingFlowProps {
  hostSlug: string;
  eventSlug: string;
  eventId: string;
  eventName: string;
  durationMinutes: number;
  description?: string | null;
}

interface AvailableSlot {
  start: string;
  end: string;
  guestDay: string;
  guestTime: string;
}

interface SlotResponse {
  slots: AvailableSlot[];
}

interface BookingResponse {
  id?: string;
  message?: string;
  managementLink?: string;
}

export function BookingFlow({
  hostSlug,
  eventSlug,
  eventId,
  eventName,
  durationMinutes,
  description,
}: BookingFlowProps) {
  const defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [timezone, setTimezone] = useState(defaultTz);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ success: boolean; text: string; link?: string } | null>(null);
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  const dateOptions = useMemo(
    () =>
      Array.from({ length: 31 }, (_, index) =>
        DateTime.now().setZone(timezone).startOf("day").plus({ days: index }).toISODate(),
      ).filter((date): date is string => date !== null),
    [timezone],
  );

  useEffect(() => {
    const controller = new AbortController();
    const from = new Date();
    const to = DateTime.utc().plus({ days: 30 }).toJSDate();
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      tz: timezone,
    });

    fetch(`/api/hosts/${hostSlug}/events/${eventSlug}/slots?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as SlotResponse & { message?: string };
        if (!response.ok) throw new Error(payload.message ?? "Unable to load available times.");
        setLoadError(null);
        setSlots(payload.slots ?? []);
        setSelectedSlot(null);
        setSelectedDate(payload.slots[0]?.guestDay ?? dateOptions[0] ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "Unable to load available times.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [dateOptions, eventSlug, hostSlug, timezone]);

  const filteredSlots = useMemo(
    () => (selectedDate ? slots.filter((slot) => slot.guestDay === selectedDate) : []),
    [selectedDate, slots],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot) {
      setMessage({ success: false, text: "Please select an available slot first." });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const signature = JSON.stringify({ eventId, selectedSlot, timezone, guestName, guestEmail });
    if (idempotencyRef.current?.signature !== signature) {
      idempotencyRef.current = { signature, key: crypto.randomUUID() };
    }

    try {
      const holdResponse = await fetch("/api/holds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyRef.current.key,
        },
        body: JSON.stringify({
          eventTypeId: eventId,
          start: selectedSlot,
          timezone,
          guestName,
          guestEmail,
        }),
      });
      const hold = (await holdResponse.json()) as BookingResponse;
      if (!holdResponse.ok || !hold.id) {
        throw new Error(hold.message ?? "Unable to hold this time.");
      }

      const confirmResponse = await fetch(`/api/holds/${hold.id}/confirm`, {
        method: "POST",
      });
      const confirmation = (await confirmResponse.json()) as BookingResponse;
      if (!confirmResponse.ok) {
        setMessage({
          success: false,
          text: confirmation.message ?? "Your hold could not be confirmed. Open its management link to retry.",
          link: hold.managementLink,
        });
        return;
      }

      setMessage({
        success: true,
        text: "Your appointment is confirmed. Save this private link to manage it.",
        link: confirmation.managementLink,
      });
      setSelectedSlot(null);
    } catch (error) {
      setMessage({
        success: false,
        text: error instanceof Error ? error.message : "Unable to complete this booking.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Appointment booking</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{eventName}</h2>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700">{durationMinutes} mins</div>
        </div>

        <div className="mb-5 flex items-center justify-between gap-3">
          <label htmlFor="guest-timezone" className="text-sm font-medium text-slate-700">Guest time zone</label>
          <select
            id="guest-timezone"
            value={timezone}
            onChange={(event) => {
              setLoading(true);
              setLoadError(null);
              setTimezone(event.target.value);
            }}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
          >
            {!["UTC", "America/New_York", "Europe/London", "Asia/Kolkata"].includes(defaultTz) ? (
              <option value={defaultTz}>{defaultTz}</option>
            ) : null}
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York</option>
            <option value="Europe/London">Europe/London</option>
            <option value="Asia/Kolkata">Asia/Kolkata</option>
          </select>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {dateOptions.map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              className={`rounded-xl border px-3 py-2 text-sm ${
                selectedDate === date
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {DateTime.fromISO(`${date}T12:00`, { zone: timezone }).toLocaleString({ month: "short", day: "numeric" })}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">Available times</h3>
            {loading ? <span className="text-xs text-slate-500">Loading...</span> : null}
          </div>
          {loadError ? <p className="mb-3 text-sm text-rose-600">{loadError}</p> : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filteredSlots.length === 0 ? (
              <p className="col-span-full text-sm text-slate-500">No slots available for this day.</p>
            ) : (
              filteredSlots.map((slot) => {
                const isSelected = selectedSlot === slot.start;
                return (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => setSelectedSlot(slot.start)}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    {slot.guestTime}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Reserve your slot</h3>
        {description ? <p className="mt-3 text-sm text-slate-600">{description}</p> : null}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Full name
            <input
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              required
              maxLength={120}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none focus:border-indigo-500 focus:bg-white"
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
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none focus:border-indigo-500 focus:bg-white"
            />
          </label>
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            Selected slot: {selectedSlot
              ? DateTime.fromISO(selectedSlot, { zone: "utc" }).setZone(timezone).toLocaleString(DateTime.DATETIME_MED)
              : "Choose a time"}
          </div>
          <button
            type="submit"
            disabled={!selectedSlot || submitting}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? "Confirming..." : "Confirm appointment"}
          </button>
        </form>

        {message ? (
          <div className={`mt-5 rounded-xl border p-3 text-sm ${message.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
            <p>{message.text}</p>
            {message.link ? (
              <a href={message.link} className="mt-2 inline-block font-semibold underline">
                Open management link
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
