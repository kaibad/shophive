import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BASEURL from "../config.js";

function Signup() {
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    password2: "",
  });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg("");
    setLoading(true);
    try {
      const res = await fetch(`${BASEURL}/api/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg("Account created! Redirecting to login...");
        setTimeout(() => nav("/login"), 1200);
      } else {
        const errorText =
          data.username?.[0] ||
          data.password?.[0] ||
          data.email?.[0] ||
          "Signup failed. Please check your details.";
        setMsg(errorText);
      }
    } catch (err) {
      console.error(err);
      setMsg("Signup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isSuccess = msg.includes("created");

  return (
    <main className="page-main flex items-center justify-center px-4 pb-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-2xl">
            🐝
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Join ShopHive</h1>
          <p className="mt-1 text-sm text-slate-500">
            Create an account to start shopping
          </p>
        </div>

        <div className="card p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                onChange={handleChange}
                value={form.username}
                placeholder="Choose a username"
                required
                className="input-field"
              />
            </div>
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                onChange={handleChange}
                value={form.email}
                placeholder="you@example.com"
                className="input-field"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                onChange={handleChange}
                value={form.password}
                placeholder="Create a password"
                required
                className="input-field"
              />
            </div>
            <div>
              <label
                htmlFor="password2"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Confirm Password
              </label>
              <input
                id="password2"
                name="password2"
                type="password"
                onChange={handleChange}
                value={form.password2}
                placeholder="Repeat your password"
                required
                className="input-field"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full !py-3"
            >
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>

          {msg && (
            <p
              className={`mt-4 rounded-lg px-3 py-2 text-center text-sm ${
                isSuccess
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {msg}
            </p>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-semibold text-brand-700 hover:text-brand-800"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default Signup;
