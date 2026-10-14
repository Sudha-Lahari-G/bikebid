import clsx from "clsx";
import { useState } from "react";
import type { Motorcycle } from "../lib/types";

const PAINT: Record<string, string> = {
  "stealth black": "#a1a1aa",
  "racing red": "#f43f5e",
  "pearl white": "#f4f4f5",
  "gunmetal grey": "#94a3b8",
  "electric blue": "#3b82f6",
  "desert sand": "#e2c08d",
  "forest green": "#34d399",
  "matte orange": "#ff7a3d",
  "chrome silver": "#cbd5e1",
  "midnight blue": "#818cf8",
};

export function paintFor(color: string | null | undefined): string {
  return (color && PAINT[color.toLowerCase()]) || "#ff5a1f";
}

type Variant = "sport" | "adventure" | "cruiser" | "standard";

function variantFor(m: Pick<Motorcycle, "model" | "make" | "engine_cc">): Variant {
  const name = `${m.make} ${m.model}`.toLowerCase();
  if (/(rc |r15|r3|ninja|cbr|panigale|rr|gixxer sf|220f|1000 rr|hayabusa)/.test(name)) return "sport";
  if (/(himalayan|adventure|xpulse|africa|v-strom|390 adv)/.test(name)) return "adventure";
  if (/(meteor|avenger|fat boy|iron|cruise)/.test(name)) return "cruiser";
  return "standard";
}

/** Line-art motorcycle, tinted with the bike's paint colour. */
function Illustration({ variant, paint }: { variant: Variant; paint: string }) {
  const lift = variant === "adventure" ? -10 : variant === "cruiser" ? 6 : 0;
  const gradientId = `tank-${paint.replace("#", "")}`;
  return (
    <svg viewBox="0 0 400 240" className="h-full w-full" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={paint} stopOpacity="0.95" />
          <stop offset="1" stopColor={paint} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {/* ground shadow */}
      <ellipse cx="203" cy="222" rx="150" ry="7" fill="black" opacity="0.45" />
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {/* wheels */}
        {[95, 310].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="172" r="47" strokeWidth="9" opacity="0.9" />
            <circle cx={cx} cy="172" r="33" strokeWidth="1.5" opacity="0.45" />
            <circle cx={cx} cy="172" r="7" strokeWidth="3" />
            <path
              d={`M${cx - 33} 172h66M${cx} 139v66M${cx - 23} 149l46 46M${cx + 23} 149l-46 46`}
              strokeWidth="1"
              opacity="0.25"
            />
          </g>
        ))}
        {/* swingarm + exhaust */}
        <path d={`M95 172 L178 ${150 + lift / 2}`} strokeWidth="6" />
        <path d={`M182 ${168 + lift / 3} L118 ${152 + lift / 2}`} strokeWidth="7" opacity="0.7" />
        {/* frame */}
        <path
          d={`M150 ${110 + lift} L182 ${155 + lift / 2} L236 ${150 + lift / 2} L262 ${86 + lift} M182 ${155 + lift / 2} L208 ${100 + lift}`}
          strokeWidth="4"
          opacity="0.75"
        />
        {/* engine block */}
        <path
          d={`M178 ${126 + lift} h52 l8 22 l-10 20 h-44 l-10 -18 z`}
          strokeWidth="3"
          fill="currentColor"
          fillOpacity="0.08"
        />
        <path d={`M190 ${134 + lift} h28 M190 ${144 + lift} h32 M190 ${154 + lift} h28`} strokeWidth="1.5" opacity="0.5" />
        {/* fork */}
        <path d={`M310 172 L${variant === "cruiser" ? 258 : 268} ${variant === "cruiser" ? 82 : 76 + lift}`} strokeWidth="6" />
        {/* handlebar */}
        <path
          d={
            variant === "sport"
              ? `M266 ${84 + lift} l-18 4`
              : variant === "cruiser"
                ? `M258 ${82 + lift} l-16 -22 l-14 2`
                : `M268 ${76 + lift} l-10 -14 l-20 -2`
          }
          strokeWidth="4"
        />
        {/* seat + tail */}
        <path
          d={
            variant === "cruiser"
              ? `M108 ${120 + lift} q20 -12 54 -10 l10 8`
              : `M96 ${104 + lift} L118 ${104 + lift} Q140 ${98 + lift} 160 ${101 + lift}`
          }
          strokeWidth="9"
          opacity="0.85"
        />
        {variant !== "cruiser" && <path d={`M96 ${104 + lift} L80 ${100 + lift}`} strokeWidth="4" />}
        {/* headlight */}
        <circle cx={variant === "cruiser" ? 270 : 280} cy={96 + lift} r="9" strokeWidth="3" />
        {/* adventure windscreen / sport fairing */}
        {variant === "adventure" && <path d={`M262 ${70 + lift} l20 -26 l6 4 l-12 30`} strokeWidth="3" opacity="0.7" />}
        {variant === "sport" && (
          <path
            d={`M246 ${74 + lift} Q300 ${70 + lift} 296 ${118 + lift} L246 ${146 + lift}`}
            strokeWidth="3"
            fill={paint}
            fillOpacity="0.22"
            stroke={paint}
          />
        )}
      </g>
      {/* tank — the coloured hero */}
      <path
        d={`M160 ${101 + lift} Q170 ${78 + lift} 210 ${76 + lift} Q246 ${76 + lift} 254 ${96 + lift} L240 ${118 + lift} Q200 ${124 + lift} 168 ${116 + lift} Z`}
        fill={`url(#${gradientId})`}
        stroke={paint}
        strokeWidth="2"
      />
      <path
        d={`M176 ${92 + lift} Q206 ${84 + lift} 236 ${90 + lift}`}
        stroke="white"
        strokeOpacity="0.5"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BikeArt({
  motorcycle,
  className,
  size = "md",
}: {
  motorcycle: Motorcycle;
  className?: string;
  size?: "md" | "lg";
}) {
  const [broken, setBroken] = useState(false);
  const paint = paintFor(motorcycle.color);

  return (
    <div
      className={clsx("relative isolate overflow-hidden bg-ink-850", className)}
      style={{
        backgroundImage: `radial-gradient(120% 90% at 70% 20%, ${paint}33, transparent 60%), linear-gradient(180deg, #16161a, #0d0d10)`,
      }}
    >
      {motorcycle.image_url && !broken ? (
        <img
          src={motorcycle.image_url}
          alt={`${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <>
          {/* blueprint grid */}
          <div
            className="absolute inset-0 -z-10 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          <span
            className={clsx(
              "pointer-events-none absolute -bottom-3 left-3 -z-10 select-none font-display font-bold uppercase leading-none tracking-tighter text-white/[0.05]",
              size === "lg" ? "text-8xl" : "text-6xl",
            )}
          >
            {motorcycle.make}
          </span>
          <div className={clsx("absolute inset-0 text-zinc-200", size === "lg" ? "p-10" : "p-5")}>
            <Illustration variant={variantFor(motorcycle)} paint={paint} />
          </div>
        </>
      )}
    </div>
  );
}
