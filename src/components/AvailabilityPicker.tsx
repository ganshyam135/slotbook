"use client";

import { DateTime } from "luxon";

export interface AvailabilitySlot {
  start: string;
  end: string;
  guestDay: string;
  guestTime: string;
  remainingCapacity: number;
  available: boolean;
}

interface AvailabilityPickerProps {
  dateOptions: string[];
  timezone: string;
  slots: AvailabilitySlot[];
  selectedDate: string | null;
  selectedSlot: string | null;
  capacity: number;
  loading: boolean;
  disabled?: boolean;
  loadError?: string | null;
  emptyMessage?: string;
  onDateChange: (date: string) => void;
  onSlotChange: (start: string) => void;
}

export function AvailabilityPicker({
  dateOptions,
  timezone,
  slots,
  selectedDate,
  selectedSlot,
  capacity,
  loading,
  disabled = false,
  loadError,
  emptyMessage = "No availability in the next 30 days. Please check back later.",
  onDateChange,
  onSlotChange,
}: AvailabilityPickerProps) {
  const dateAvailability = new Map<string, { count: number; limited: boolean }>();
  for (const slot of slots) {
    const current = dateAvailability.get(slot.guestDay) ?? { count: 0, limited: false };
    if (slot.available) {
      current.count += 1;
      current.limited ||= capacity > 1 && slot.remainingCapacity < capacity;
    }
    dateAvailability.set(slot.guestDay, current);
  }
  const filteredSlots = selectedDate
    ? slots.filter((slot) => slot.guestDay === selectedDate)
    : [];

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {dateOptions.map((date) => {
          const availability = dateAvailability.get(date);
          const unavailable = !loading && (!availability || availability.count === 0);
          const limited = availability?.limited ?? false;
          const dateLabel = DateTime.fromISO(`${date}T12:00`, { zone: timezone })
            .setLocale("en-US")
            .toLocaleString({ month: "short", day: "numeric" });
          const availabilityLabel = loading
            ? "Availability loading"
            : availability
              ? `${availability.count} available time${availability.count === 1 ? "" : "s"}${limited ? ", limited capacity" : ""}`
              : "No available times";

          return (
            <button
              key={date}
              type="button"
              disabled={disabled || loading || unavailable}
              aria-label={`${dateLabel}, ${availabilityLabel}`}
              aria-pressed={selectedDate === date}
              onClick={() => onDateChange(date)}
              className={`flex min-h-16 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
                loading
                  ? "border-slate-200 bg-slate-50 text-slate-500"
                  : selectedDate === date
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : unavailable
                      ? "border-slate-200 bg-slate-100 text-slate-400"
                      : limited
                        ? "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300"
                        : "border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300"
              }`}
            >
              <span className="font-medium">{dateLabel}</span>
              <span className={`mt-0.5 flex items-center gap-1.5 text-xs ${
                loading || unavailable ? "text-slate-500" : limited ? "text-amber-800" : "text-emerald-800"
              }`}>
                <span aria-hidden="true" className={`size-2 rounded-full ${
                  loading || unavailable ? "bg-slate-400" : limited ? "bg-amber-500" : "bg-emerald-500"
                }`} />
                {loading ? "Checking" : availability?.count ? `${availability.count} times` : "No slots"}
              </span>
            </button>
          );
        })}
      </div>

      <div aria-label="Availability legend" className="mb-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />Available</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-amber-500" />Limited capacity</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-slate-400" />Unavailable</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">Available times</h3>
          {loading ? <span className="text-xs text-slate-500">Loading...</span> : null}
        </div>
        {loadError ? <p className="mb-3 text-sm text-rose-600">{loadError}</p> : null}
        {!loading && !loadError && slots.length === 0 ? (
          <p className="mb-3 text-sm text-slate-600">{emptyMessage}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filteredSlots.length === 0 ? (
            <p className="col-span-full text-sm text-slate-500">
              {selectedDate ? "No slots available for this day." : "Choose a date with availability to see times."}
            </p>
          ) : (
            filteredSlots.map((slot) => {
              const isSelected = selectedSlot === slot.start;
              const limited = slot.available && capacity > 1 && slot.remainingCapacity < capacity;
              return (
                <button
                  key={slot.start}
                  type="button"
                  disabled={disabled || !slot.available}
                  aria-pressed={isSelected}
                  aria-label={`${slot.guestTime}, ${slot.available
                    ? limited
                      ? `${slot.remainingCapacity} spaces remaining`
                      : "available"
                    : "unavailable"}`}
                  onClick={() => onSlotChange(slot.start)}
                  className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                    isSelected
                      ? "border-indigo-700 bg-indigo-600 text-white"
                      : !slot.available
                        ? "border-slate-200 bg-slate-100 text-slate-400"
                        : limited
                          ? "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300"
                          : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300"
                  }`}
                >
                  <span>{slot.guestTime}</span>
                  {!slot.available ? (
                    <span className="text-xs font-normal">Unavailable</span>
                  ) : limited ? (
                    <span className="text-xs font-normal">{slot.remainingCapacity} left</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
