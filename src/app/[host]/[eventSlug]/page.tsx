import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/BookingFlow";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: Promise<{ host: string; eventSlug: string }>;
}) {
  const { host, eventSlug } = await params;

  const hostRecord = await db.host.findUnique({
    where: { slug: host },
    include: { eventTypes: true },
  });

  if (!hostRecord) {
    notFound();
  }

  const event = hostRecord.eventTypes.find((entry) => entry.slug === eventSlug);
  if (!event) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-600">{hostRecord.name}</p>
          <h1 className="mt-3 text-4xl font-semibold text-slate-900">{event.name}</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Choose an open time that works for you. All appointments are held for five minutes before confirmation.
          </p>
        </div>

        <BookingFlow
          hostSlug={hostRecord.slug}
          eventSlug={event.slug}
          eventId={event.id}
          eventName={event.name}
          durationMinutes={event.durationMinutes}
          capacity={event.capacity}
          description={`Available for ${event.capacity} guest${event.capacity > 1 ? "s" : ""} · ${event.durationMinutes} minute session`}
        />
      </div>
    </main>
  );
}
