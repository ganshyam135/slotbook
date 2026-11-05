"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";

export function HostProfileForm({
  name: initialName,
  timezone: initialTimezone,
  email,
}: {
  name: string;
  timezone: string;
  email: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ success: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/host/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, timezone }),
      });
      const result = (await response.json()) as {
        host?: { name: string; timezone: string };
        message?: string;
      };
      if (!response.ok || !result.host) {
        throw new Error(result.message ?? "Could not update your profile.");
      }

      setName(result.host.name);
      setTimezone(result.host.timezone);
      setMessage({ success: true, text: "Profile saved." });
      router.refresh();
    } catch (error) {
      setMessage({
        success: false,
        text: error instanceof Error ? error.message : "Could not update your profile.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">Email: {email}</div>
      <label className="block text-sm font-medium text-slate-700">
        Host name
        <input
          required
          minLength={2}
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Home time zone (IANA)
        <input
          required
          maxLength={100}
          placeholder="Asia/Kolkata"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          className={inputClass}
        />
      </label>
      <p className="text-xs text-slate-500">
        Use a named IANA zone such as America/New_York or Asia/Kolkata.
      </p>
      {message ? (
        <p
          role={message.success ? "status" : "alert"}
          className={`text-sm ${message.success ? "text-emerald-700" : "text-rose-700"}`}
        >
          {message.text}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
