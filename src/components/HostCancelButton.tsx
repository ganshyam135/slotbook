"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function HostCancelButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function cancel() {
    const reason = window.prompt("Why are you cancelling this booking?");
    if (!reason) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/host/bookings/${encodeURIComponent(bookingId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Unable to cancel booking.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to cancel booking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={busy}
        onClick={() => void cancel()}
        className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
      >
        {busy ? "Cancelling..." : "Cancel"}
      </button>
      {message ? <p role="status" className="mt-1 text-xs text-rose-600">{message}</p> : null}
    </div>
  );
}
