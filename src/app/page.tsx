import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-10 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-600">Slotbook</p>
          </div>
          <div className="flex gap-3">
            <Link href="/login" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">
              Host login
            </Link>
            <Link href="/demo-host/intro-call" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
              Book a demo
            </Link>
          </div>
        </nav>

        <section className="grid gap-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Modern appointment booking</p>
            <h1 className="mt-4 max-w-xl text-5xl font-semibold tracking-tight text-slate-900">
              Book smarter, faster, and without double-booking.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              Slotbook gives hosts a clear dashboard and guests a frictionless booking experience built around real availability, hold expiry and reliable scheduling logic.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/demo-host/intro-call" className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500">
                View demo booking page
              </Link>
              <Link href="/login" className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                Open host dashboard
              </Link>
            </div>
          </div>

          <div className="rounded-3xl bg-slate-50 p-6">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Host portal</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">Demo host</p>
                <p className="mt-1 text-sm text-slate-600">Availability, rules and bookings in one place.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Guest flow</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">Browse · Select · Confirm</p>
                <p className="mt-1 text-sm text-slate-600">Clear slot selection with timezone-aware availability.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Booking engine</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">Safe and consistent</p>
                <p className="mt-1 text-sm text-slate-600">Held slots expire automatically and do not consume capacity forever.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
