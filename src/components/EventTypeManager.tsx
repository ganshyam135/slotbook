"use client";

import { useState } from "react";
import { DateOverrideEditor } from "@/components/DateOverrideEditor";
import { WeeklyAvailabilityEditor } from "@/components/WeeklyAvailabilityEditor";

interface ManagedEventType {
  id: string;
  name: string;
  slug: string;
  durationMinutes: number;
  capacity: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  bookingHorizonDays: number;
  _count: { bookings: number };
  availabilityRules: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
  availabilityOverrides: Array<{
    id: string;
    localDate: Date | string;
    isUnavailable: boolean;
    startMinute: number | null;
    endMinute: number | null;
  }>;
}

type EventFormValues = Pick<
  ManagedEventType,
  | "name"
  | "slug"
  | "durationMinutes"
  | "capacity"
  | "bufferBeforeMinutes"
  | "bufferAfterMinutes"
  | "minNoticeMinutes"
  | "bookingHorizonDays"
>;

const emptyValues: EventFormValues = {
  name: "",
  slug: "",
  durationMinutes: 30,
  capacity: 1,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  bookingHorizonDays: 30,
};

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";

export function EventTypeManager({
  initialEventTypes,
  hostSlug,
}: {
  initialEventTypes: ManagedEventType[];
  hostSlug: string;
}) {
  const [eventTypes, setEventTypes] = useState(initialEventTypes);
  const [values, setValues] = useState<EventFormValues>(emptyValues);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ success: boolean; text: string } | null>(null);

  function startCreate() {
    setEditingId(null);
    setValues(emptyValues);
    setMessage(null);
    setFormOpen(true);
  }

  function startEdit(eventType: ManagedEventType) {
    setEditingId(eventType.id);
    setValues({
      name: eventType.name,
      slug: eventType.slug,
      durationMinutes: eventType.durationMinutes,
      capacity: eventType.capacity,
      bufferBeforeMinutes: eventType.bufferBeforeMinutes,
      bufferAfterMinutes: eventType.bufferAfterMinutes,
      minNoticeMinutes: eventType.minNoticeMinutes,
      bookingHorizonDays: eventType.bookingHorizonDays,
    });
    setMessage(null);
    setFormOpen(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    const payload = {
      ...values,
      durationMinutes: Number(values.durationMinutes),
      capacity: Number(values.capacity),
      bufferBeforeMinutes: Number(values.bufferBeforeMinutes),
      bufferAfterMinutes: Number(values.bufferAfterMinutes),
      minNoticeMinutes: Number(values.minNoticeMinutes),
      bookingHorizonDays: Number(values.bookingHorizonDays),
    };

    try {
      const response = await fetch(
        editingId ? `/api/host/event-types/${editingId}` : "/api/host/event-types",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as {
        eventType?: ManagedEventType;
        message?: string;
      };
      if (!response.ok || !result.eventType) {
        throw new Error(result.message ?? "Could not save event type.");
      }

      setEventTypes((current) =>
        editingId
          ? current.map((eventType) => (eventType.id === editingId ? result.eventType! : eventType))
          : [...current, result.eventType!],
      );
      setFormOpen(false);
      setMessage({ success: true, text: editingId ? "Event type updated." : "Event type created." });
    } catch (error) {
      setMessage({
        success: false,
        text: error instanceof Error ? error.message : "Could not save event type.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove(eventType: ManagedEventType) {
    if (!window.confirm(`Delete "${eventType.name}"? Events with any booking history cannot be deleted.`)) {
      return;
    }
    setDeletingId(eventType.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/host/event-types/${eventType.id}`, { method: "DELETE" });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not delete event type.");
      setEventTypes((current) => current.filter((entry) => entry.id !== eventType.id));
      if (editingId === eventType.id) setFormOpen(false);
      setMessage({ success: true, text: "Event type deleted." });
    } catch (error) {
      setMessage({
        success: false,
        text: error instanceof Error ? error.message : "Could not delete event type.",
      });
    } finally {
      setDeletingId(null);
    }
  }

  function updateField<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{eventTypes.length} event type(s)</p>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Add event type
        </button>
      </div>

      {message ? (
        <p
          role="status"
          className={`mb-4 rounded-xl border p-3 text-sm ${
            message.success
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="space-y-3">
        {eventTypes.length === 0 ? (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No event types yet.</p>
        ) : (
          eventTypes.map((eventType) => (
            <article key={eventType.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{eventType.name}</p>
                  <p className="text-sm text-slate-600">/{eventType.slug}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {eventType.durationMinutes} min · capacity {eventType.capacity} · {eventType._count.bookings} booking(s)
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href={`/${hostSlug}/${eventType.slug}`}
                    className="text-sm font-medium text-indigo-600"
                  >
                    Public page
                  </a>
                  <button
                    type="button"
                    onClick={() => startEdit(eventType)}
                    className="text-sm font-medium text-slate-700"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(eventType)}
                    disabled={deletingId === eventType.id}
                    className="text-sm font-medium text-rose-600 disabled:opacity-50"
                  >
                    {deletingId === eventType.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
              <details className="mt-4 border-t border-slate-200 pt-2">
                <summary className="cursor-pointer text-sm font-medium text-indigo-700">
                  Availability and date overrides
                </summary>
                <WeeklyAvailabilityEditor
                  eventTypeId={eventType.id}
                  initialWindows={eventType.availabilityRules}
                />
                <DateOverrideEditor
                  eventTypeId={eventType.id}
                  initialOverrides={eventType.availabilityOverrides}
                />
              </details>
            </article>
          ))
        )}
      </div>

      {formOpen ? (
        <form onSubmit={submit} className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">
              {editingId ? "Edit event type" : "New event type"}
            </h3>
            <button type="button" onClick={() => setFormOpen(false)} className="text-sm text-slate-600">
              Close
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Name
              <input
                required
                minLength={2}
                maxLength={100}
                value={values.name}
                onChange={(event) => updateField("name", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              URL slug
              <input
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                maxLength={60}
                value={values.slug}
                onChange={(event) => updateField("slug", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Duration (15–120 minutes)
              <input
                required
                type="number"
                min={15}
                max={120}
                step={15}
                value={values.durationMinutes}
                onChange={(event) => updateField("durationMinutes", Number(event.target.value))}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Group capacity
              <input
                required
                type="number"
                min={1}
                max={100}
                step={1}
                value={values.capacity}
                onChange={(event) => updateField("capacity", Number(event.target.value))}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Buffer before (minutes)
              <input
                required
                type="number"
                min={0}
                max={30}
                value={values.bufferBeforeMinutes}
                onChange={(event) => updateField("bufferBeforeMinutes", Number(event.target.value))}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Buffer after (minutes)
              <input
                required
                type="number"
                min={0}
                max={30}
                value={values.bufferAfterMinutes}
                onChange={(event) => updateField("bufferAfterMinutes", Number(event.target.value))}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Minimum notice (minutes)
              <input
                required
                type="number"
                min={0}
                max={43200}
                value={values.minNoticeMinutes}
                onChange={(event) => updateField("minNoticeMinutes", Number(event.target.value))}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Booking horizon (days)
              <input
                required
                type="number"
                min={1}
                max={365}
                value={values.bookingHorizonDays}
                onChange={(event) => updateField("bookingHorizonDays", Number(event.target.value))}
                className={inputClass}
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Slugs use lowercase letters, numbers, and hyphens. Duration must use 15-minute increments.
          </p>
          {message && !message.success ? (
            <p role="alert" className="mt-3 text-sm text-rose-700">{message.text}</p>
          ) : null}
          <button
            type="submit"
            disabled={saving}
            className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : editingId ? "Save changes" : "Create event type"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
