import { STATUS_LABEL } from "@/lib/format";

export function Banner({ error, note }: { error?: string; note?: string }) {
  if (error) return <p className="banner bad">{error}</p>;
  if (note) return <p className="banner good">{note}</p>;
  return null;
}

export function Pill({ value }: { value: string }) {
  return <span className={`pill ${value}`}>{STATUS_LABEL[value] ?? value.replaceAll("_", " ")}</span>;
}
