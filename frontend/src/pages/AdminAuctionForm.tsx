import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Save } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AuctionCard } from "../components/AuctionCard";
import { Field, Skeleton, Spinner } from "../components/ui";
import { ApiError, api, errorMessage } from "../lib/api";
import { formatINR } from "../lib/format";
import type { AdminAuction, Auction, AuctionInput, Condition } from "../lib/types";

const DURATIONS = [
  { label: "10 min", minutes: 10 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 60 * 24 },
  { label: "3 days", minutes: 60 * 24 * 3 },
  { label: "7 days", minutes: 60 * 24 * 7 },
];
const CONDITIONS: Condition[] = ["excellent", "good", "fair", "project"];
const COLORS = ["Stealth Black", "Racing Red", "Pearl White", "Gunmetal Grey", "Electric Blue", "Desert Sand", "Forest Green", "Matte Orange", "Chrome Silver", "Midnight Blue"];

/** <input type="datetime-local"> works in local time without a zone. */
function toLocalInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

interface FormState {
  title: string;
  titleTouched: boolean;
  make: string;
  model: string;
  year: string;
  mileage_km: string;
  engine_cc: string;
  condition: Condition;
  color: string;
  location: string;
  description: string;
  image_url: string;
  starting_price: string;
  reserve_price: string;
  min_increment: string;
  startMode: "now" | "later";
  starts_at: string;
  durationMinutes: number | null;
  ends_at: string;
}

function initialState(existing?: AdminAuction): FormState {
  const start = new Date(Date.now() + 60 * 60_000);
  if (!existing) {
    return {
      title: "",
      titleTouched: false,
      make: "",
      model: "",
      year: String(new Date().getFullYear() - 2),
      mileage_km: "",
      engine_cc: "",
      condition: "good",
      color: "Stealth Black",
      location: "",
      description: "",
      image_url: "",
      starting_price: "",
      reserve_price: "",
      min_increment: "1000",
      startMode: "now",
      starts_at: toLocalInput(start),
      durationMinutes: 60 * 24,
      ends_at: toLocalInput(new Date(start.getTime() + 24 * 3_600_000)),
    };
  }
  const m = existing.motorcycle;
  return {
    title: existing.title,
    titleTouched: true,
    make: m.make,
    model: m.model,
    year: String(m.year),
    mileage_km: String(m.mileage_km),
    engine_cc: String(m.engine_cc),
    condition: m.condition,
    color: m.color ?? "",
    location: m.location,
    description: m.description,
    image_url: m.image_url ?? "",
    starting_price: String(existing.starting_price),
    reserve_price: existing.reserve_price ? String(existing.reserve_price) : "",
    min_increment: String(existing.min_increment),
    startMode: "later",
    starts_at: toLocalInput(new Date(existing.starts_at)),
    durationMinutes: null,
    ends_at: toLocalInput(new Date(existing.ends_at)),
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="mb-5 font-display text-lg font-semibold">{title}</h2>
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function AdminAuctionForm() {
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const existing = useQuery({
    queryKey: ["admin", "auction", editId],
    queryFn: () => api.admin.auction(editId!),
    enabled: editId !== null,
  });

  if (editId !== null && existing.isLoading) return <Skeleton className="h-[40rem]" />;
  if (editId !== null && existing.data && existing.data.status !== "scheduled") {
    return (
      <div className="card p-8 text-center">
        <p className="text-zinc-300">Only upcoming auctions can be edited — this one is {existing.data.status}.</p>
        <Link to="/admin" className="btn-ghost mt-4">
          Back to dashboard
        </Link>
      </div>
    );
  }
  return <AuctionForm key={existing.data?.id ?? "new"} existing={existing.data} />;
}

function AuctionForm({ existing }: { existing?: AdminAuction }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(() => initialState(existing));
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((s) => ({ ...s, [key]: value }));

  // Suggest a title from year/make/model until the admin types their own.
  useEffect(() => {
    if (!f.titleTouched) {
      setF((s) => ({ ...s, title: [s.year, s.make, s.model].filter(Boolean).join(" ") }));
    }
  }, [f.year, f.make, f.model, f.titleTouched]);

  const num = (v: string) => Number(v.replace(/[^\d]/g, ""));
  const startDate = f.startMode === "now" ? new Date() : new Date(f.starts_at);
  const endDate = f.durationMinutes ? new Date(startDate.getTime() + f.durationMinutes * 60_000) : new Date(f.ends_at);

  const errors: Record<string, string | undefined> = {
    make: f.make.trim() ? undefined : "Required",
    model: f.model.trim() ? undefined : "Required",
    year: num(f.year) >= 1900 && num(f.year) <= new Date().getFullYear() + 1 ? undefined : "Enter a valid year",
    mileage_km: f.mileage_km !== "" ? undefined : "Required",
    engine_cc: num(f.engine_cc) > 0 ? undefined : "Required",
    location: f.location.trim().length >= 2 ? undefined : "Required",
    title: f.title.trim().length >= 3 ? undefined : "At least 3 characters",
    starting_price: num(f.starting_price) > 0 ? undefined : "Enter a starting price",
    reserve_price:
      f.reserve_price && num(f.reserve_price) < num(f.starting_price) ? "Must be at least the starting price" : undefined,
    min_increment: num(f.min_increment) > 0 ? undefined : "Required",
    starts_at: f.startMode === "later" && startDate.getTime() <= Date.now() ? "Must be in the future" : undefined,
    ends_at:
      endDate.getTime() - startDate.getTime() < 60_000
        ? "Must be at least 1 minute after the start"
        : endDate.getTime() - Date.now() < 90_000
          ? "Must end at least a couple of minutes from now"
          : undefined,
    image_url: f.image_url && !/^https?:\/\/\S+$/.test(f.image_url) ? "Must be an http(s) URL" : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const err = (key: string) => (submitted ? errors[key] : undefined) ?? serverErrors[key];

  const payload: AuctionInput = {
    title: f.title.trim(),
    motorcycle: {
      make: f.make.trim(),
      model: f.model.trim(),
      year: num(f.year),
      mileage_km: num(f.mileage_km),
      engine_cc: num(f.engine_cc),
      condition: f.condition,
      color: f.color.trim() || null,
      location: f.location.trim(),
      description: f.description.trim(),
      image_url: f.image_url.trim() || null,
    },
    starting_price: num(f.starting_price),
    reserve_price: f.reserve_price ? num(f.reserve_price) : null,
    min_increment: num(f.min_increment),
    starts_at: startDate.toISOString(),
    ends_at: endDate.toISOString(),
  };

  const save = useMutation({
    mutationFn: () => (existing ? api.admin.update(existing.id, payload) : api.admin.create(payload)),
    onSuccess: (auction) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["auctions"] });
      toast.success(existing ? "Auction updated" : auction.status === "live" ? "Auction is live!" : "Auction scheduled");
      navigate(`/auctions/${auction.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
        const list = (error.details.errors as { field: string; message: string }[] | undefined) ?? [];
        setServerErrors(Object.fromEntries(list.map((e) => [e.field.split(".").pop() ?? e.field, e.message])));
      }
      toast.error(errorMessage(error));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setServerErrors({});
    if (valid) save.mutate();
    else toast.error("Please fix the highlighted fields");
  };

  const preview: Auction = {
    id: existing?.id ?? 0,
    title: payload.title || "Your listing title",
    status: f.startMode === "now" && !existing ? "live" : "scheduled",
    starting_price: payload.starting_price || 0,
    current_price: payload.starting_price || 0,
    min_increment: payload.min_increment,
    next_min_bid: payload.starting_price,
    bid_count: 0,
    has_reserve: payload.reserve_price !== null,
    reserve_met: false,
    leading_bidder: null,
    winner: null,
    starts_at: payload.starts_at,
    ends_at: payload.ends_at,
    extension_count: 0,
    ended_at: null,
    motorcycle: { id: 0, ...payload.motorcycle, make: payload.motorcycle.make || "Make" },
  };

  const input = (key: keyof FormState, props: Record<string, unknown> = {}) => (
    <input
      id={key}
      value={f[key] as string}
      onChange={(e) => set(key, e.target.value as never)}
      className={clsx("input", err(key) && "border-red-500/50")}
      {...props}
    />
  );

  return (
    <div className="animate-fade-up">
      <Link to="/admin" className="mb-5 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>
      <h1 className="mb-8 font-display text-3xl font-bold tracking-tight">{existing ? "Edit auction" : "List a motorcycle"}</h1>

      <form onSubmit={submit} noValidate className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Section title="Motorcycle">
            <Field label="Make" htmlFor="make" error={err("make")}>
              {input("make", { placeholder: "Royal Enfield", list: "makes" })}
            </Field>
            <Field label="Model" htmlFor="model" error={err("model")}>
              {input("model", { placeholder: "Classic 350" })}
            </Field>
            <Field label="Year" htmlFor="year" error={err("year")}>
              {input("year", { inputMode: "numeric" })}
            </Field>
            <Field label="Mileage (km)" htmlFor="mileage_km" error={err("mileage_km")}>
              {input("mileage_km", { inputMode: "numeric", placeholder: "12000" })}
            </Field>
            <Field label="Engine (cc)" htmlFor="engine_cc" error={err("engine_cc")}>
              {input("engine_cc", { inputMode: "numeric", placeholder: "349" })}
            </Field>
            <Field label="Condition" htmlFor="condition">
              <select id="condition" value={f.condition} onChange={(e) => set("condition", e.target.value as Condition)} className="input capitalize">
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Colour" htmlFor="color">
              {input("color", { list: "colors" })}
            </Field>
            <Field label="Location" htmlFor="location" error={err("location")}>
              {input("location", { placeholder: "Hyderabad, TS" })}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Photo URL (optional)" htmlFor="image_url" error={err("image_url")} hint="Leave empty to use the illustrated card">
                {input("image_url", { placeholder: "https://…" })}
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="description" hint="Service history, modifications, known issues">
                <textarea
                  id="description"
                  rows={4}
                  maxLength={5000}
                  value={f.description}
                  onChange={(e) => set("description", e.target.value)}
                  className="input resize-y"
                />
              </Field>
            </div>
          </Section>

          <Section title="Auction">
            <div className="sm:col-span-2">
              <Field label="Listing title" htmlFor="title" error={err("title")}>
                <input
                  id="title"
                  value={f.title}
                  onChange={(e) => setF((s) => ({ ...s, title: e.target.value, titleTouched: true }))}
                  className={clsx("input", err("title") && "border-red-500/50")}
                />
              </Field>
            </div>
            <Field label="Starting bid (₹)" htmlFor="starting_price" error={err("starting_price")}>
              {input("starting_price", { inputMode: "numeric", placeholder: "100000" })}
            </Field>
            <Field label="Reserve price (₹, optional)" htmlFor="reserve_price" error={err("reserve_price")} hint="Hidden from bidders. No sale below this.">
              {input("reserve_price", { inputMode: "numeric" })}
            </Field>
            <Field label="Bid increment (₹)" htmlFor="min_increment" error={err("min_increment")}>
              {input("min_increment", { inputMode: "numeric" })}
            </Field>
            <div />
            {!existing && (
              <div className="sm:col-span-2">
                <span className="label">Start</span>
                <div className="flex gap-2">
                  {(["now", "later"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => set("startMode", mode)}
                      className={clsx(
                        "rounded-xl border px-4 py-2 text-sm font-medium transition",
                        f.startMode === mode ? "border-flame-500/60 bg-flame-500/10 text-flame-200" : "border-white/10 text-zinc-400 hover:text-zinc-200",
                      )}
                    >
                      {mode === "now" ? "Go live now" : "Schedule"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {f.startMode === "later" && (
              <Field label="Starts at" htmlFor="starts_at" error={err("starts_at")}>
                <input id="starts_at" type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} className="input" />
              </Field>
            )}
            <div className="sm:col-span-2">
              <span className="label">Duration</span>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.minutes}
                    type="button"
                    onClick={() => set("durationMinutes", d.minutes)}
                    className={clsx(
                      "rounded-xl border px-3 py-1.5 text-sm transition",
                      f.durationMinutes === d.minutes ? "border-flame-500/60 bg-flame-500/10 text-flame-200" : "border-white/10 text-zinc-400 hover:text-zinc-200",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    set("ends_at", toLocalInput(endDate));
                    set("durationMinutes", null);
                  }}
                  className={clsx(
                    "rounded-xl border px-3 py-1.5 text-sm transition",
                    f.durationMinutes === null ? "border-flame-500/60 bg-flame-500/10 text-flame-200" : "border-white/10 text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  Custom end
                </button>
              </div>
              {f.durationMinutes === null && (
                <input
                  aria-label="Ends at"
                  type="datetime-local"
                  value={f.ends_at}
                  onChange={(e) => set("ends_at", e.target.value)}
                  className="input mt-3 sm:w-72"
                />
              )}
              {err("ends_at") && <p className="mt-1.5 text-xs text-red-400">{err("ends_at")}</p>}
              <p className="mt-2 text-xs text-zinc-500">
                Ends {endDate.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. Bids in the final 2 minutes
                extend the auction.
              </p>
            </div>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Preview</div>
          <div className="pointer-events-none">
            <AuctionCard auction={preview} />
          </div>
          {payload.reserve_price && (
            <p className="text-xs text-zinc-500">Reserve {formatINR(payload.reserve_price)} is only visible to admins.</p>
          )}
          <button type="submit" className="btn-primary w-full py-3" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
            {existing ? "Save changes" : f.startMode === "now" ? "Publish & go live" : "Schedule auction"}
          </button>
        </aside>

        <datalist id="makes">
          {["Royal Enfield", "KTM", "Bajaj", "Honda", "Yamaha", "TVS", "Hero", "Suzuki", "Kawasaki", "Triumph", "Harley-Davidson", "BMW", "Ducati", "Jawa"].map(
            (m) => (
              <option key={m} value={m} />
            ),
          )}
        </datalist>
        <datalist id="colors">
          {COLORS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </form>
    </div>
  );
}
