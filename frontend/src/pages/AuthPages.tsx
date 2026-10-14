import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, PlayCircle } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Field, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { TokenResponse } from "../lib/types";

const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL as string | undefined;
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD as string | undefined;

function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-white/[0.06] bg-ink-900/70 shadow-card lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-flame-600 via-flame-700 to-ink-950 p-10 lg:block">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative flex h-full flex-col justify-between">
          <span className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-white/70">BikeBid</span>
          <div>
            <p className="font-display text-4xl font-bold leading-tight text-white">
              Your next ride is one bid away.
            </p>
            <p className="mt-4 max-w-sm text-white/75">
              Watch prices move in real time, get alerted the moment you're outbid, and never lose to a last-second snipe.
            </p>
          </div>
          <p className="text-xs text-white/50">Prices in INR · Free to join</p>
        </div>
      </div>
      <div className="p-8 sm:p-12">
        <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-zinc-500 hover:text-zinc-200"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function useFinishAuth() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return (response: TokenResponse) => {
    signIn(response);
    toast.success(`Welcome, ${response.user.full_name.split(" ")[0]}!`);
    navigate(from && from !== "/login" ? from : response.user.role === "admin" ? "/admin" : "/", { replace: true });
  };
}

export function LoginPage() {
  const { user } = useAuth();
  const finish = useFinishAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({ mutationFn: api.login, onSuccess: finish });

  if (user) return <Navigate to="/" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        <>
          New to BikeBid?{" "}
          <Link to="/register" className="font-medium text-flame-400 hover:text-flame-300">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Email" htmlFor="email">
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        {login.isError && (
          <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
            {errorMessage(login.error)}
          </p>
        )}
        <button type="submit" className="btn-primary w-full py-3" disabled={login.isPending || !email || !password}>
          {login.isPending && <Spinner />} Sign in
        </button>
      </form>
      {DEMO_EMAIL && DEMO_PASSWORD && (
        <div className="mt-6 border-t border-white/[0.06] pt-6">
          <button
            type="button"
            className="btn-ghost w-full py-3"
            disabled={login.isPending}
            onClick={() => login.mutate({ email: DEMO_EMAIL, password: DEMO_PASSWORD })}
          >
            <PlayCircle className="h-4 w-4 text-flame-400" /> Try the demo bidder account
          </button>
          <p className="mt-2 text-center text-xs text-zinc-500">No sign-up needed — jump straight into a live auction.</p>
        </div>
      )}
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user } = useAuth();
  const finish = useFinishAuth();
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [touched, setTouched] = useState(false);
  const register = useMutation({ mutationFn: api.register, onSuccess: finish });

  if (user) return <Navigate to="/" replace />;

  const errors = {
    full_name: form.full_name.trim().length < 2 ? "Please enter your name" : undefined,
    email: /^\S+@\S+\.\S+$/.test(form.email) ? undefined : "Enter a valid email address",
    password: form.password.length < 8 ? "Use at least 8 characters" : undefined,
  };
  const valid = !errors.full_name && !errors.email && !errors.password;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (valid) register.mutate(form);
  };
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        <>
          Already registered?{" "}
          <Link to="/login" className="font-medium text-flame-400 hover:text-flame-300">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Full name" htmlFor="full_name" error={touched ? errors.full_name : undefined} hint="Others see your first name and last initial">
          <input id="full_name" autoComplete="name" value={form.full_name} onChange={(e) => set("full_name")(e.target.value)} className="input" />
        </Field>
        <Field label="Email" htmlFor="email" error={touched ? errors.email : undefined}>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email")(e.target.value)} className="input" />
        </Field>
        <Field label="Password" htmlFor="password" error={touched ? errors.password : undefined} hint="At least 8 characters">
          <PasswordInput id="password" value={form.password} onChange={set("password")} autoComplete="new-password" />
        </Field>
        {register.isError && (
          <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
            {errorMessage(register.error)}
          </p>
        )}
        <button type="submit" className="btn-primary w-full py-3" disabled={register.isPending}>
          {register.isPending && <Spinner />} Create account
        </button>
      </form>
    </AuthShell>
  );
}
