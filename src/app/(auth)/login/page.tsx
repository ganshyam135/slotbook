import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="grid gap-8 md:grid-cols-2 md:items-center">
          <div className="space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-indigo-600">Slotbook</p>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-900">Host scheduling, simplified.</h1>
            <p className="max-w-md text-base text-slate-600">
              Manage your weekly availability, review bookings, and offer a polished public booking experience in a single dashboard.
            </p>
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              Sign in with the host email and password configured in your environment.
            </div>
          </div>

          <LoginForm />
        </div>
      </div>
    </main>
  );
}
