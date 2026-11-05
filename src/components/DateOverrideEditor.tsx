"use client";

import { useState } from "react";
import { AvailabilityTimeSelect } from "@/components/AvailabilityTimeSelect";

interface DateOverride {
  id: string;
  localDate: Date | string;
  isUnavailable: boolean;
  startMinute: number | null;
  endMinute: number | null;
}

interface OverrideForm {
  localDate: string;
  isUnavailable: boolean;
  startMinute: number;
  endMinute: number;
}

const newOverride: OverrideForm = {
  localDate: "",
  isUnavailable: true,
  startMinute: 540,
  endMinute: 1020,
};

function formatLocalDate(value: Date | string) {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function formatMinute(value: number) {
  if (value === 1440) return "24:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function DateOverrideEditor({
  eventTypeId,
  initialOverrides,
}: {
  eventTypeId: string;
  initialOverrides: DateOverride[];
}) {
  const [overrides, setOverrides] = useState(initialOverrides);
  const [values, setValues] = useState<OverrideForm>(newOverride);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ success: boolean; text: string } | null>(null);

  function edit(override: DateOverride) {
    setEditingId(override.id);
    setValues({
      localDate: formatLocalDate(override.localDate),
      isUnavailable: override.isUnavailable,
      startMinute: override.startMinute ?? 540,
      endMinute: override.endMinute ?? 1020,
    });
    setMessage(null);
  }

  function reset() {
    setEditingId(null);
    setValues(newOverride);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const payload = values.isUnavailable
      ? { localDate: values.localDate, isUnavailable: true }
      : {
          localDate: values.localDate,
          isUnavailable: false,
          startMinute: values.startMinute,
          endMinute: values.endMinute,
        };

    try {
      const response = await fetch(
        editingId
          ? `/api/host/event-types/${eventTypeId}/overrides/${editingId}`
          : `/api/host/event-types/${eventTypeId}/overrides`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as { override?: DateOverride; message?: string };
      if (!response.ok || !result.override) {
        throw new Error(result.message ?? "Could not save date override.");
      }

      setOverrides((current) =>
        editingId
          ? current.map((override) => (override.id === editingId ? result.override! : override))
          : [...current, result.override!].sort((a, b) =>
              formatLocalDate(a.localDate).localeCompare(formatLocalDate(b.localDate)),
            ),
      );
      reset();
      setMessage({ success: true, text: "Date override saved." });
    } catch (error) {
      setMessage({
        success: false,
        text: error instanceof Error ? error.message : "Could not save date override.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove(overrideId: string) {
    setMessage(null);
    try {
      const response = await fetch(
        `/api/host/event-types/${eventTypeId}/overrides/${overrideId}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not delete date override.");
      setOverrides((current) => current.filter((override) => override.id !== overrideId));
      if (editingId === overrideId) reset();
      setMessage({ success: true, text: "Date override removed." });
    } catch (error) {
      setMessage({
        success: false,
        text: error instanceof Error ? error.message : "Could not delete date override.",
      });
    }
  }

  return (
    <section className="mt-4 border-t border-slate-200 pt-4">
      <h4 className="font-medium text-slate-800">Date overrides</h4>
      <p className="mt-1 text-xs text-slate-500">
        Overrides replace weekly hours for that host-local date.
      </p>
      {overrides.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No date overrides.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {overrides.map((override) => (
            <li key={override.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
              <span className="text-sm text-slate-800">
                {formatLocalDate(override.localDate)} ·{" "}
                {override.isUnavailable
                  ? "Unavailable"
                  : `${formatMinute(override.startMinute ?? 0)}–${formatMinute(override.endMinute ?? 0)}`}
              </span>
              <span className="flex gap-3">
                <button type="button" onClick={() => edit(override)} className="text-xs font-medium text-indigo-600">
                  Edit
                </button>
                <button type="button" onClick={() => void remove(override.id)} className="text-xs font-medium text-rose-600">
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save} className="mt-3 rounded-xl bg-slate-50 p-3">
        <label className="block text-sm font-medium text-slate-700">
          Host-local date
          <input
            type="date"
            required
            value={values.localDate}
            onChange={(event) => setValues((current) => ({ ...current, localDate: event.target.value }))}
            className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={values.isUnavailable}
            onChange={(event) =>
              setValues((current) => ({ ...current, isUnavailable: event.target.checked }))
            }
          />
          Mark unavailable
        </label>
        {!values.isUnavailable ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AvailabilityTimeSelect
              value={values.startMinute}
              onChange={(startMinute) => setValues((current) => ({ ...current, startMinute }))}
            />
            <span className="text-xs text-slate-500">to</span>
            <AvailabilityTimeSelect
              value={values.endMinute}
              endTime
              onChange={(endMinute) => setValues((current) => ({ ...current, endMinute }))}
            />
          </div>
        ) : null}
        {message ? (
          <p
            role={message.success ? "status" : "alert"}
            className={`mt-3 text-sm ${message.success ? "text-emerald-700" : "text-rose-700"}`}
          >
            {message.text}
          </p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : editingId ? "Update override" : "Add override"}
          </button>
          {editingId ? (
            <button type="button" onClick={reset} className={buttonClass}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

const buttonClass = "rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white";
