import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HostCancelButton } from "@/components/HostCancelButton";
import { EventTypeManager } from "@/components/EventTypeManager";
import { HostProfileForm } from "@/components/HostProfileForm";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const hostId = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!hostId) {
    redirect("/login");
  }

  const now = new Date();
  const host = await db.host.findUnique({
    where: { id: hostId },
    include: {
      eventTypes: {
        include: {
          _count: { select: { bookings: true } },
          bookings: {
            where: {
              startUtc: { gte: now },
              OR: [
                { status: "confirmed" },
                { status: "held", expiresAt: { gt: now } },
              ],
            },
            orderBy: { startUtc: "asc" },
            take: 10,
          },
        },
      },
    },
  });

  if (!host) {
    redirect("/login");
  }

  const upcomingBookings = host.eventTypes.flatMap((event) =>
    event.bookings.map((booking) => ({
      ...booking,
      eventName: event.name,
    })),
  );

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <aside className="mb-8 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-600">Slotbook</p>
            <h1 className="mt-1 text-2xl font-semibold">{host.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            {host.eventTypes[0] ? (
              <Link href={`/${host.slug}/${host.eventTypes[0].slug}`} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Public page
              </Link>
            ) : null}
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Bookings</p>
            <p className="mt-2 text-3xl font-semibold">{upcomingBookings.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Event types</p>
            <p className="mt-2 text-3xl font-semibold">{host.eventTypes.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Timezone</p>
            <p className="mt-2 text-xl font-semibold">{host.timezone}</p>
          </div>
        </div>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Upcoming bookings</h2>
          </div>

          <div className="space-y-3">
            {upcomingBookings.length === 0 ? (
              <p className="text-sm text-slate-500">No bookings yet.</p>
            ) : (
              upcomingBookings.map((booking) => (
                <div key={booking.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <p className="font-medium text-slate-900">{booking.eventName}</p>
                    <p className="text-sm text-slate-600">
                      {booking.guestName ?? "Guest"} · {new Date(booking.startUtc).toLocaleString(undefined, { timeZone: host.timezone })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                      {booking.status}
                    </span>
                    <HostCancelButton bookingId={booking.id} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Event types</h2>
            <div className="mt-4">
              <EventTypeManager initialEventTypes={host.eventTypes} hostSlug={host.slug} />
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Profile</h2>
            <div className="mt-4">
              <HostProfileForm name={host.name} timezone={host.timezone} email={host.email} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
