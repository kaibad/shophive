import { Link } from "react-router-dom";

const FOOTER_LINKS = {
  shop: [
    { label: "All Products", to: "/shop" },
    { label: "Headphones", to: "/shop?category=headphones" },
    { label: "Speakers", to: "/shop?category=speakers" },
    { label: "Smart Watches", to: "/shop?category=watch" },
  ],
  company: [
    { label: "About Me", to: "/about" },
    { label: "Contact", to: "/contact" },
    { label: "Shop", to: "/shop" },
  ],
  account: [
    { label: "Login", to: "/login" },
    { label: "Sign Up", to: "/signup" },
    { label: "Cart", to: "/cart" },
  ],
};

function Footer() {
  return (
    <footer className="mt-auto border-t border-brand-100 bg-brand-900 text-white">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link
              to="/"
              className="text-2xl font-extrabold tracking-tight text-white"
            >
              shop<span className="text-brand-400">hive</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-brand-200">
              A modern full-stack e-commerce platform built with Django,
              PostgreSQL, and React — crafted by Kailash Badu.
            </p>
            <div className="mt-5 flex gap-3">
              <a
                href="https://www.linkedin.com/in/kailash-badu/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-brand-500"
                aria-label="LinkedIn"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 114.126 0 2.065 2.065 0 01-2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
              <a
                href="mailto:badukailash001@gmail.com"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-brand-500"
                aria-label="Email"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Shop links */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-300">
              Shop
            </h3>
            <ul className="mt-4 space-y-2.5">
              {FOOTER_LINKS.shop.map(({ label, to }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="text-sm text-brand-200 transition-colors hover:text-white"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company links */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-300">
              Company
            </h3>
            <ul className="mt-4 space-y-2.5">
              {FOOTER_LINKS.company.map(({ label, to }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="text-sm text-brand-200 transition-colors hover:text-white"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact info */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-300">
              Get in Touch
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-brand-200">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-brand-400">📍</span>
                Lalitpur, Nepal
              </li>
              <li>
                <a
                  href="mailto:badukailash001@gmail.com"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <span className="text-brand-400">✉️</span>
                  badukailash001@gmail.com
                </a>
              </li>
              <li>
                <a
                  href="tel:+9779843952547"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <span className="text-brand-400">📞</span>
                  +977 9843952547
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
          <p className="text-sm text-brand-300">
            © {new Date().getFullYear()} ShopHive. Built by{" "}
            <Link to="/about" className="font-medium text-white hover:text-brand-300">
              Kailash Badu
            </Link>
            .
          </p>
          <p className="text-xs text-brand-400">
            Django · PostgreSQL · React · Tailwind CSS
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
