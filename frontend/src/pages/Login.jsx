import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveTokens } from "../utils/auth";
import BASEURL from "../config.js";

function Login() {
  const [form, setForm] = useState({ username: "", password: "" });
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
      const res = await fetch(`${BASE}/api/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        saveTokens(data);
        setMsg("Login successful!");
        setTimeout(() => nav("/"), 800);
      } else {
        setMsg(data.detail || "Invalid credentials");
      }
    } catch (err) {
      console.error(err);
      setMsg("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isError = msg && !msg.includes("successful");

  return (
    <main className="page-main flex items-center justify-center px-4 pb-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-2xl">
            🐝
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to your ShopHive account
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
                placeholder="Enter your username"
                required
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
                placeholder="Enter your password"
                required
                className="input-field"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full !py-3"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          {msg && (
            <p
              className={`mt-4 rounded-lg px-3 py-2 text-center text-sm ${
                isError
                  ? "bg-red-50 text-red-600"
                  : "bg-green-50 text-green-700"
              }`}
            >
              {msg}
            </p>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            Don&apos;t have an account?{" "}
            <Link
              to="/signup"
              className="font-semibold text-brand-700 hover:text-brand-800"
            >
              Create one
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default Login;
