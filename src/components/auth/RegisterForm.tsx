"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";

export function RegisterForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");

  const [name, setName] = useState("");

  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setError(null);

    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Unable to create account");

        return;
      }

      router.push("/projects");

      router.refresh();
    } catch {
      setError("Unable to create account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="register-email"
          className="mb-1.5 block text-sm text-[#b4b7bf]"
        >
          Email
        </label>

        <input
          id="register-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-[#62666f] focus:border-white/40"
          placeholder="you@company.com"
        />
      </div>

      <div>
        <label
          htmlFor="register-name"
          className="mb-1.5 block text-sm text-[#b4b7bf]"
        >
          Name{" "}
          <span className="text-[#62666f]">(optional)</span>
        </label>

        <input
          id="register-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-[#62666f] focus:border-white/40"
          placeholder="Jane Smith"
        />
      </div>

      <div>
        <label
          htmlFor="register-password"
          className="mb-1.5 block text-sm text-[#b4b7bf]"
        >
          Password
        </label>

        <input
          id="register-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-[#62666f] focus:border-white/40"
          placeholder="At least 8 characters"
        />
      </div>

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : null}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}