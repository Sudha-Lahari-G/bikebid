/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        ink: {
          950: "#09090b",
          900: "#111114",
          850: "#16161a",
          800: "#1c1c21",
          700: "#27272e",
          600: "#3a3a44",
        },
        flame: {
          300: "#ffb38f",
          400: "#ff8a57",
          500: "#ff5a1f",
          600: "#e94a10",
          700: "#c23a0b",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,90,31,.35), 0 8px 30px -8px rgba(255,90,31,.45)",
        card: "0 1px 0 0 rgba(255,255,255,.04) inset, 0 10px 30px -15px rgba(0,0,0,.8)",
      },
      keyframes: {
        flash: {
          "0%": { color: "#ff8a57", transform: "scale(1.06)" },
          "100%": { color: "inherit", transform: "scale(1)" },
        },
        "slide-in": {
          "0%": { opacity: "0", transform: "translateY(-6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        ping2: {
          "75%, 100%": { transform: "scale(2.2)", opacity: "0" },
        },
      },
      animation: {
        flash: "flash 900ms ease-out",
        "slide-in": "slide-in 350ms ease-out",
        "fade-up": "fade-up 400ms ease-out both",
        ping2: "ping2 1.6s cubic-bezier(0,0,.2,1) infinite",
      },
    },
  },
  plugins: [],
};
