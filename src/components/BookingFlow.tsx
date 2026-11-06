"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AvailabilityPicker } from "@/components/AvailabilityPicker";

const subscribeToBrowserTimezone = () => () => {};
const getBrowserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const getServerTimezone = () => "UTC";

interface BookingFlowProps {
  hostSlug: string;
  eventSlug: string;
  eventId: string;
  eventName: string;
  durationMinutes: number;
  capacity: number;
  description?: string | null;
}

interface AvailableSlot {
  start: string;
  end: string;
  guestDay: string;
  guestTime: string;
  remainingCapacity: number;
}

interface SlotAvailability extends AvailableSlot {
  available: boolean;
}

interface SlotResponse {
  slots: AvailableSlot[];
  availability: SlotAvailability[];
}

interface BookingResponse {
  id?: string;
  status?: string;
  expiresAt?: string;
  message?: string;
  managementLink?: string;
}

interface ActiveHold {
  id: string;
  expiresAt: string;
  managementLink: string;
  start: string;
}

interface ConfirmedBooking {
  managementLink: string;
  start: string;
}

export function BookingFlow({
  hostSlug,
  eventSlug,
  eventId,
  eventName,
  durationMinutes,
  capacity,
  description,
}: BookingFlowProps) {
  const defaultTz = useSyncExternalStore(
    subscribeToBrowserTimezone,
    getBrowserTimezone,
    getServerTimezone,
  );
  const [timezoneOverride, setTimezoneOverride] = useState<string | null>(null);
  const timezone = timezoneOverride ?? defaultTz;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [timeOptions, setTimeOptions] = useState<SlotAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeHold, setActiveHold] = useState<ActiveHold | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<ConfirmedBooking | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
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
        setTimeOptions(payload.availability ?? (payload.slots ?? []).map((slot) => ({
          ...slot,
          available: true,
        })));
        setSelectedSlot(null);
        setSelectedDate(payload.slots[0]?.guestDay ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "Unable to load available times.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [availabilityVersion, dateOptions, eventSlug, hostSlug, timezone]);

  useEffect(() => {
    if (!activeHold) return;
    const updateRemaining = () => {
      setSecondsRemaining(Math.max(0, Math.ceil((new Date(activeHold.expiresAt).getTime() - Date.now()) / 1000)));
    };
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [activeHold]);

  function refreshAvailability() {
    setLoading(true);
    setAvailabilityVersion((version) => version + 1);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot) {
      setMessage("Please select an available slot first.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const signature = JSON.stringify({ eventId, selectedSlot, timezone });
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
        }),
      });
      const hold = (await holdResponse.json()) as BookingResponse;
      if (
        !holdResponse.ok ||
        !hold.id ||
        hold.status !== "held" ||
        !hold.expiresAt ||
        !hold.managementLink
      ) {
        if (holdResponse.status === 409) {
          setSelectedSlot(null);
          refreshAvailability();
          throw new Error("That time is no longer available. Availability has been refreshed; choose another time.");
        }
        throw new Error(hold.message ?? "Unable to hold this time.");
      }

      const newHold = {
        id: hold.id,
        expiresAt: hold.expiresAt,
        managementLink: hold.managementLink,
        start: selectedSlot,
      };
      setActiveHold(newHold);
      setSecondsRemaining(Math.max(0, Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 1000)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reserve this time.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeHold || secondsRemaining <= 0) {
      setMessage("This hold has expired. Select an available time to try again.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const confirmResponse = await fetch(`/api/holds/${activeHold.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName, guestEmail }),
      });
      const confirmation = (await confirmResponse.json()) as BookingResponse;
      if (!confirmResponse.ok || confirmation.status !== "confirmed" || !confirmation.managementLink) {
        if (confirmResponse.status === 409) {
          setActiveHold(null);
          setSelectedSlot(null);
          refreshAvailability();
        }
        throw new Error(confirmation.message ?? "Your booking could not be confirmed.");
      }

      setConfirmedBooking({ managementLink: confirmation.managementLink, start: activeHold.start });
      setActiveHold(null);
      setSelectedSlot(null);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to confirm this booking.");
    } finally {
      setSubmitting(false);
    }
  }

  function chooseAnotherTime() {
    setActiveHold(null);
    setSelectedSlot(null);
    setMessage(null);
    idempotencyRef.current = null;
  }

  const bookingLocked = Boolean(activeHold || confirmedBooking);
  const timeRemaining = `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`;
  const summaryStart = confirmedBooking?.start ?? activeHold?.start ?? selectedSlot;
  const summaryDateTime = summaryStart
    ? DateTime.fromISO(summaryStart, { zone: "utc" })
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
              setSelectedSlot(null);
              setTimeOptions([]);
              setTimezoneOverride(event.target.value);
            }}
            disabled={bookingLocked}
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

        <AvailabilityPicker
          dateOptions={dateOptions}
          timezone={timezone}
          slots={timeOptions}
          selectedDate={selectedDate}
          selectedSlot={selectedSlot}
          capacity={capacity}
          loading={loading}
          disabled={bookingLocked}
          loadError={loadError}
          onDateChange={(date) => {
            setSelectedDate(date);
            setSelectedSlot(null);
          }}
          onSlotChange={setSelectedSlot}
        />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">
          {confirmedBooking ? "Booking confirmed" : activeHold ? "Complete your booking" : "Reserve your slot"}
        </h3>
        {description ? <p className="mt-3 text-sm text-slate-600">{description}</p> : null}
        <div className="mt-6 space-y-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-medium text-slate-900">
              {confirmedBooking ? "Appointment" : activeHold ? "Held appointment" : "Selected appointment"}
            </p>
            <p className="mt-1">{summaryDateTime ?? "Choose a date and available time"}</p>
            <p className="mt-2 text-xs text-slate-600">
              {durationMinutes} minutes · Capacity {capacity} {capacity === 1 ? "guest" : "guests"} · {timezone}
            </p>
          </div>

          {!activeHold && !confirmedBooking ? (
            <form onSubmit={handleSubmit}>
              <button
                type="submit"
                disabled={!selectedSlot || submitting}
                className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {submitting ? "Reserving..." : "Hold this time for 5 minutes"}
              </button>
            </form>
          ) : null}

          {activeHold && secondsRemaining > 0 ? (
            <>
              <p role="status" className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <span>Held for you. Enter your details and confirm before it expires.</span>
                <strong aria-label="Time remaining to confirm" className="shrink-0 rounded-lg bg-amber-200 px-2.5 py-1 font-mono text-base tabular-nums">
                  {timeRemaining}
                </strong>
              </p>
              <form onSubmit={handleConfirm} className="space-y-4">
                <label className="block text-sm font-medium text-slate-700">
                  Full name
                  <input
                    value={guestName}
                    onChange={(event) => setGuestName(event.target.value)}
                    required
                    minLength={2}
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
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {submitting ? "Confirming..." : "Confirm booking"}
                </button>
              </form>
              <a href={activeHold.managementLink} className="inline-block text-sm font-semibold text-indigo-700 underline">
                Save this private hold link
              </a>
            </>
          ) : null}

          {activeHold && secondsRemaining <= 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <p>This hold expired. It no longer reserves the time.</p>
              <button type="button" onClick={chooseAnotherTime} className="mt-2 font-semibold underline">
                Choose another time
              </button>
              <a href={activeHold.managementLink} className="ml-4 font-semibold underline">
                View hold status
              </a>
            </div>
          ) : null}

          {confirmedBooking ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <p className="font-semibold">Your appointment is confirmed.</p>
              <p className="mt-1">The server confirmed your booking. Save this private link to reschedule or cancel.</p>
              <a href={confirmedBooking.managementLink} className="mt-2 inline-block font-semibold underline">
                Manage your booking
              </a>
              <button
                type="button"
                onClick={() => {
                  setConfirmedBooking(null);
                  setGuestName("");
                  setGuestEmail("");
                  setMessage(null);
                }}
                className="mt-3 block text-indigo-700 underline"
              >
                Book another appointment
              </button>
            </div>
          ) : null}

          {message ? (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
