import { Link, useNavigate, useLocation } from "react-router-dom";
import { useCart } from "../context/CartContext.jsx";
import { clearTokens, getAccessToken } from "../utils/auth.js";
import { useState } from "react";

const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "Shop", to: "/shop" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

function Navbar() {
  const { cartItems } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");

  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);
  const isLoggedIn = !!getAccessToken();

  const handleLogout = () => {
    clearTokens();
    navigate("/login");
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const q = search.trim();
    if (q) {
      navigate(`/shop?q=${encodeURIComponent(q)}`);
    } else {
      navigate("/shop");
    }
  };

  const isActive = (path) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-brand-100/80 bg-white/95 backdrop-blur-md">
      <nav className="mx-auto flex h-[4.5rem] max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link
          to="/"
          className="shrink-0 text-xl font-extrabold tracking-tight text-brand-900"
        >
          shop<span className="text-brand-500">hive</span>
        </Link>

        {/* Center nav links */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map(({ label, to }) => (
            <Link
              key={to}
              to={to}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                isActive(to)
                  ? "text-brand-600"
                  : "text-brand-800 hover:text-brand-500"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Search + actions */}
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <form onSubmit={handleSearch} className="hidden sm:block">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
                />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products"
                className="w-44 rounded-full border border-brand-100 bg-[#f4f6fc] py-2.5 pl-10 pr-4 text-sm text-brand-900 outline-none transition-all placeholder:text-slate-400 focus:w-52 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15 lg:w-56 lg:focus:w-64"
              />
            </div>
          </form>

          <Link
            to="/cart"
            className="relative flex h-10 w-10 items-center justify-center rounded-full text-brand-800 transition-colors hover:bg-brand-50"
            aria-label="Cart"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 9m12-9l2 9m-6-4h.01M11 17h.01"
              />
            </svg>
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
              {cartCount}
            </span>
          </Link>

          {!isLoggedIn ? (
            <Link
              to="/login"
              className="rounded-full bg-brand-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
            >
              Login
            </Link>
          ) : (
            <button
              onClick={handleLogout}
              className="rounded-full border border-brand-200 px-5 py-2 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-50"
            >
              Logout
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}

export default Navbar;
