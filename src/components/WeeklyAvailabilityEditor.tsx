"use client";

import { useState } from "react";
import { AvailabilityTimeSelect } from "@/components/AvailabilityTimeSelect";

interface AvailabilityWindow {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface EditableWindow extends AvailabilityWindow {
  key: string;
}

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const buttonClass = "rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white";

function firstFreeHour(day: number, windows: EditableWindow[]) {
  const sorted = windows.filter((window) => window.dayOfWeek === day).sort((a, b) => a.startMinute - b.startMinute);
  const preferred = sorted.length > 0 ? Math.min(sorted[sorted.length - 1].endMinute + 15, 1380) : 540;
  const candidates = [
    ...Array.from({ length: Math.floor((1440 - 60 - preferred) / 15) + 1 }, (_, index) => preferred + index * 15),
    ...Array.from({ length: Math.floor((preferred - 60) / 15) + 1 }, (_, index) => index * 15),
  ];
  return candidates.find((startMinute) =>
    sorted.every((window) => startMinute >= window.endMinute || startMinute + 60 <= window.startMinute),
  );
}

export function WeeklyAvailabilityEditor({
  eventTypeId,
  initialWindows,
}: {
  eventTypeId: string;
  initialWindows: AvailabilityWindow[];
}) {
  const [windows, setWindows] = useState<EditableWindow[]>(
    initialWindows.map((window, index) => ({ ...window, key: `${window.dayOfWeek}-${window.startMinute}-${index}` })),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ success: boolean; text: string } | null>(null);

  function setDayEnabled(day: number, enabled: boolean) {
    setWindows((current) => {
      if (!enabled) return current.filter((window) => window.dayOfWeek !== day);
      if (current.some((window) => window.dayOfWeek === day)) return current;
      return [...current, { dayOfWeek: day, startMinute: 540, endMinute: 1020, key: crypto.randomUUID() }];
    });
  }

  function addWindow(day: number) {
    const count = windows.filter((window) => window.dayOfWeek === day).length;
    if (count >= 5) {
      setMessage({ success: false, text: "Each weekday can have at most five windows." });
      return;
    }
    const startMinute = firstFreeHour(day, windows);
    if (startMinute === undefined) {
      setMessage({ success: false, text: `No one-hour opening remains on ${days[day]}.` });
      return;
    }
    setMessage(null);
    setWindows((current) => [
      ...current,
      { dayOfWeek: day, startMinute, endMinute: startMinute + 60, key: crypto.randomUUID() },
    ]);
  }

  function updateWindow(key: string, field: "startMinute" | "endMinute", value: number) {
    setWindows((current) =>
      current.map((window) => (window.key === key ? { ...window, [field]: value } : window)),
    );
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const payload = {
      windows: windows.map(({ dayOfWeek, startMinute, endMinute }) => ({
        dayOfWeek,
        startMinute,
        endMinute,
      })),
    };

    try {
      const response = await fetch(`/api/host/event-types/${eventTypeId}/availability`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not save weekly availability.");
      setMessage({ success: true, text: "Weekly availability saved." });
    } catch (error) {
      setMessage({
        success: false,
        text: error instanceof Error ? error.message : "Could not save weekly availability.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 border-t border-slate-200 pt-4">
      <h4 className="font-medium text-slate-800">Weekly availability</h4>
      <p className="mt-1 text-xs text-slate-500">Times use the host&apos;s configured home time zone.</p>
      <div className="mt-3 space-y-3">
        {days.map((dayName, dayOfWeek) => {
          const dayWindows = windows
            .filter((window) => window.dayOfWeek === dayOfWeek)
            .sort((left, right) => left.startMinute - right.startMinute);
          return (
            <div key={dayOfWeek} className="rounded-xl bg-slate-50 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={dayWindows.length > 0}
                  onChange={(event) => setDayEnabled(dayOfWeek, event.target.checked)}
                />
                {dayName}
              </label>
              {dayWindows.length > 0 ? (
                <div className="mt-2 space-y-2 pl-6">
                  {dayWindows.map((window) => (
                    <div key={window.key} className="flex flex-wrap items-center gap-2">
                      <AvailabilityTimeSelect
                        value={window.startMinute}
                        onChange={(value) => updateWindow(window.key, "startMinute", value)}
                      />
                      <span className="text-xs text-slate-500">to</span>
                      <AvailabilityTimeSelect
                        value={window.endMinute}
                        endTime
                        onChange={(value) => updateWindow(window.key, "endMinute", value)}
                      />
                      <button
                        type="button"
                        onClick={() => setWindows((current) => current.filter((entry) => entry.key !== window.key))}
                        className="text-xs font-medium text-rose-600"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addWindow(dayOfWeek)} className={buttonClass}>
                    Add window
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {message ? (
        <p
          role={message.success ? "status" : "alert"}
          className={`mt-3 text-sm ${message.success ? "text-emerald-700" : "text-rose-700"}`}
        >
          {message.text}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save weekly hours"}
      </button>
    </section>
  );
}
