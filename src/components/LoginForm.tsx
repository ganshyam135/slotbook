"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: "Unable to sign in." }))) as { message?: string };
      setError(payload.message ?? "Unable to sign in.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-600">Host portal</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Sign in</h1>
      </div>

      <div className="space-y-5">
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            placeholder="demo@slotbook.app"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none ring-0 transition focus:border-indigo-500 focus:bg-white"
            required
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none ring-0 transition focus:border-indigo-500 focus:bg-white"
            required
          />
        </label>

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Signing in..." : "Continue to dashboard"}
        </button>
      </div>
    </form>
  );
}
