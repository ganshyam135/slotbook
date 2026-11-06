import Link from "next/link";
import { BookingManagementActions } from "@/components/BookingManagementActions";
import { getBookingByToken } from "@/lib/booking-service";

export const dynamic = "force-dynamic";

export default async function BookingManagementPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const booking = /^[a-f0-9]{64}$/i.test(token) ? await getBookingByToken(token) : null;

  if (!booking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Booking not found</h1>
          <p className="mt-3 text-slate-600">This management link may be invalid.</p>
          <Link href="/" className="mt-5 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const holdExpired = booking.status === "held" && (!booking.expiresAt || booking.expiresAt <= new Date());
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: booking.eventType.host.timezone,
  });

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Manage booking</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-900">{booking.eventType.name}</h1>
        <div className="mt-6 space-y-3 text-sm text-slate-700">
          <div className="rounded-2xl bg-slate-50 p-4">Status: {holdExpired ? "expired" : booking.status}</div>
          <div className="rounded-2xl bg-slate-50 p-4">Guest: {booking.guestName ?? "Guest"}</div>
          <div className="rounded-2xl bg-slate-50 p-4">Email: {booking.guestEmail ?? "Not provided"}</div>
          <div className="rounded-2xl bg-slate-50 p-4">
            Starts ({booking.eventType.host.timezone}): {dateFormatter.format(booking.startUtc)}
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            Ends ({booking.eventType.host.timezone}): {dateFormatter.format(booking.endUtc)}
          </div>
        </div>
        <BookingManagementActions
          bookingId={booking.id}
          token={token}
          hostSlug={booking.eventType.host.slug}
          eventSlug={booking.eventType.slug}
          durationMinutes={booking.eventType.durationMinutes}
          capacity={booking.eventType.capacity}
          status={holdExpired ? "expired" : booking.status}
          holdExpired={holdExpired}
          guestName={booking.guestName}
          guestEmail={booking.guestEmail}
        />
      </div>
    </main>
  );
}
