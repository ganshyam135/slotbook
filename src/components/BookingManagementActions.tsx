"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface BookingManagementActionsProps {
  bookingId: string;
  token: string;
  status: string;
  holdExpired: boolean;
}

export function BookingManagementActions({ bookingId, token, status, holdExpired }: BookingManagementActionsProps) {
  const router = useRouter();
  const [newStart, setNewStart] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (!response.ok) throw new Error(payload.message ?? "Request failed.");
      setMessage(payload.message ?? "Booking updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "held") {
    return (
      <div className="mt-6 space-y-3">
        <p className="text-sm text-slate-600">
          {holdExpired ? "This hold has expired." : "This time is held for up to five minutes."}
        </p>
        {!holdExpired ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(`/api/holds/${encodeURIComponent(bookingId)}/confirm`, {})}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Confirming..." : "Confirm booking"}
          </button>
        ) : null}
        {message ? <p role="status" className="text-sm text-slate-600">{message}</p> : null}
      </div>
    );
  }

  if (status !== "confirmed") {
    return <p className="mt-6 text-sm text-slate-600">This booking is {status} and can no longer be changed.</p>;
  }

  return (
    <div className="mt-6 space-y-4 border-t border-slate-200 pt-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = new Date(newStart);
          if (!Number.isFinite(value.getTime())) {
            setMessage("Choose a valid date and time.");
            return;
          }
          void submit(`/api/bookings/${encodeURIComponent(token)}/reschedule`, {
            newStart: value.toISOString(),
          });
        }}
        className="space-y-3"
      >
        <label className="block text-sm font-medium text-slate-700">
          Reschedule to
          <input
            type="datetime-local"
            value={newStart}
            onChange={(event) => setNewStart(event.target.value)}
            required
            className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          Reschedule
        </button>
      </form>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(`/api/bookings/${encodeURIComponent(token)}/cancel`, { reason });
        }}
        className="space-y-3"
      >
        <label className="block text-sm font-medium text-slate-700">
          Cancellation reason
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={2}
            maxLength={500}
            className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Cancel booking
        </button>
      </form>
      {message ? <p role="status" className="text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}
