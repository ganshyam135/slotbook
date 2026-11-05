const timeOptions = Array.from({ length: 97 }, (_, index) => {
  const minutes = index * 15;
  const label =
    minutes === 1440
      ? "24:00"
      : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { minutes, label };
});

export function AvailabilityTimeSelect({
  value,
  onChange,
  endTime = false,
}: {
  value: number;
  onChange: (minutes: number) => void;
  endTime?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800"
    >
      {timeOptions
        .filter((option) => (endTime ? option.minutes > 0 : option.minutes < 1440))
        .map((option) => (
          <option key={option.minutes} value={option.minutes}>{option.label}</option>
        ))}
    </select>
  );
}
