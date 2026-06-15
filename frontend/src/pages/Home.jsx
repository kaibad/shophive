import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ProductCard from "../components/ProductCard";

const CATEGORIES = [
  "Headphones",
  "Speakers",
  "Watch",
  "Earbuds",
  "Mouse",
  "Decoration",
];

function Home() {
  const [products, setProducts] = useState([]);
  const BASEURL = import.meta.env.VITE_DJANGO_BASE_URL;

  useEffect(() => {
    fetch(`${BASEURL}/api/products/`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setProducts(data))
      .catch(() => setProducts([]));
  }, [BASEURL]);

  const featured = products[0];
  const promo = products[1];
  const lowestPrice =
    products.length > 0
      ? Math.min(...products.map((p) => Number(p.price)))
      : 4.9;

  return (
    <main className="page-main">
      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        {/* Hero grid — matches screenshot layout */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-2">
          {/* Main hero — spans 2 cols, 2 rows on large screens */}
          <div className="hero-card relative bg-gradient-to-br from-brand-100 via-[#d4e4ff] to-brand-50 lg:col-span-2 lg:row-span-2">
            <div className="flex h-full min-h-[320px] flex-col justify-between p-6 sm:min-h-[380px] sm:p-8 lg:min-h-[420px]">
              <div className="max-w-md">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-brand-800 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    News
                  </span>
                  <span className="text-sm font-medium text-brand-800">
                    Free Shipping on Orders Above $50!
                  </span>
                </div>
                <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-brand-900 sm:text-4xl lg:text-[2.75rem]">
                  Gadgets you&apos;ll love.
                  <br />
                  Prices you&apos;ll trust.
                </h1>
                <p className="mt-3 text-base font-medium text-brand-600 sm:text-lg">
                  Starts from ${lowestPrice.toFixed(2)}
                </p>
                <Link
                  to="/shop"
                  className="mt-6 inline-flex rounded-xl bg-brand-900 px-8 py-3 text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-brand-600 hover:shadow-lg"
                >
                  Learn More
                </Link>
              </div>

              <div className="pointer-events-none absolute bottom-0 right-0 top-0 hidden w-[45%] sm:block">
                <img
                  src="https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=600&h=700&fit=crop"
                  alt="Happy shopper with headphones"
                  className="h-full w-full object-cover object-top"
                />
              </div>
            </div>
          </div>

          {/* Best products card */}
          <Link
            to="/shop"
            className="hero-card group flex min-h-[180px] flex-col justify-between bg-gradient-to-br from-[#fde8d8] to-[#fce4cf] p-5 transition-transform hover:scale-[1.02] sm:min-h-[200px] sm:p-6"
          >
            <div>
              <h2 className="text-xl font-extrabold text-brand-900 sm:text-2xl">
                Best products
              </h2>
              <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 group-hover:gap-2 transition-all">
                View more →
              </span>
            </div>
            <div className="flex justify-end">
              <img
                src={
                  featured?.image
                    ? `${BASEURL}${featured.image}`
                    : "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=200&h=200&fit=crop"
                }
                alt={featured?.name || "Featured product"}
                className="h-24 w-24 object-contain drop-shadow-md sm:h-28 sm:w-28"
              />
            </div>
          </Link>

          {/* Discount card */}
          <Link
            to="/shop"
            className="hero-card group flex min-h-[180px] flex-col justify-between bg-gradient-to-br from-brand-100 to-[#c5d4ff] p-5 transition-transform hover:scale-[1.02] sm:min-h-[200px] sm:p-6"
          >
            <div>
              <h2 className="text-xl font-extrabold text-brand-900 sm:text-2xl">
                20% discounts
              </h2>
              <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 group-hover:gap-2 transition-all">
                View more →
              </span>
            </div>
            <div className="flex justify-end">
              <img
                src={
                  promo?.image
                    ? `${BASEURL}${promo.image}`
                    : "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=200&h=200&fit=crop"
                }
                alt={promo?.name || "Promo product"}
                className="h-24 w-24 object-contain drop-shadow-md sm:h-28 sm:w-28"
              />
            </div>
          </Link>
        </section>

        {/* Category pills */}
        <section className="mt-6 flex flex-wrap gap-3">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat}
              to={`/shop?category=${cat.toLowerCase()}`}
              className="rounded-full border border-brand-100 bg-white px-5 py-2.5 text-sm font-medium text-brand-800 shadow-sm transition-all hover:border-brand-500 hover:bg-brand-50 hover:text-brand-600"
            >
              {cat}
            </Link>
          ))}
        </section>

        {/* Featured products strip */}
        {products.length > 0 && (
          <section className="mt-14">
            <div className="mb-6 flex items-end justify-between">
              <div>
                <h2 className="section-title">Trending Now</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Hand-picked favorites from our hive
                </p>
              </div>
              <Link
                to="/shop"
                className="text-sm font-semibold text-brand-600 hover:text-brand-800"
              >
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {products.slice(0, 4).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        )}

        {/* Promo banner */}
        <section className="mt-14 overflow-hidden rounded-[1.75rem] bg-gradient-to-r from-brand-800 via-brand-600 to-brand-500 px-8 py-12 text-center text-white sm:px-12">
          <h2 className="text-2xl font-bold sm:text-3xl">
            Join ShopHive today
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-brand-100">
            Sign up for exclusive deals, faster checkout, and a personalized
            shopping experience.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/signup"
              className="rounded-full bg-white px-8 py-3 text-sm font-bold text-brand-800 transition hover:bg-brand-50"
            >
              Get Started
            </Link>
            <Link
              to="/shop"
              className="rounded-full border border-white/40 px-8 py-3 text-sm font-bold text-white transition hover:bg-white/10"
            >
              Browse Shop
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

export default Home;
