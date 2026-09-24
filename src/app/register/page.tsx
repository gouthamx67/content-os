import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getCurrentUser } from "../../infrastructure/auth/current-user";
import { RegisterForm } from "../../components/auth/RegisterForm";

export default async function RegisterPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/projects");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#08090b] px-5 text-white">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-black">
            <Sparkles size={16} />
          </div>

          <span className="text-lg font-semibold tracking-tight">
            Content OS
          </span>
        </Link>

        <div className="rounded-2xl border border-[#24272e] bg-[#101216] p-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Create your account
          </h1>

          <p className="mt-1 text-sm text-[#777b84]">
            Your first workspace is created automatically.
          </p>

          <div className="mt-6">
            <RegisterForm />
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-[#777b84]">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-white underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}