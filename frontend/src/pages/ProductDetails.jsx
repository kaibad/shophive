import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useCart } from "../context/CartContext";
import LoadingSpinner from "../components/LoadingSpinner";
import EmptyState from "../components/EmptyState";
import BASEURL from "../config.js";

function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState(false);
  const { addToCart } = useCart();

  useEffect(() => {
    fetch(`${BASEURL}/api/products/${id}/`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch product details");
        }
        return response.json();
      })
      .then((data) => {
        setProduct(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id, BASEURL]);

  const handleAddToCart = async () => {
    if (!localStorage.getItem("access_token")) {
      navigate("/login");
      return;
    }
    await addToCart(product.id);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  if (loading) {
    return (
      <main className="page-main">
        <LoadingSpinner label="Loading product..." />
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-main px-4">
        <div className="mx-auto max-w-3xl">
          <EmptyState
            icon="⚠️"
            title="Could not load product"
            description={error}
          />
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="page-main px-4">
        <div className="mx-auto max-w-3xl">
          <EmptyState
            icon="🔍"
            title="Product not found"
            description="This item may have been removed."
          />
        </div>
      </main>
    );
  }

  const imageSrc = product.image?.startsWith("http")
    ? product.image
    : `${BASEURL}${product.image}`;

  return (
    <main className="page-main px-4 pb-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/shop"
          className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-brand-600"
        >
          ← Back to shop
        </Link>

        <div className="card overflow-hidden">
          <div className="grid gap-0 md:grid-cols-2">
            <div className="aspect-square bg-stone-100 md:aspect-auto">
              <img
                src={imageSrc}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            </div>

            <div className="flex flex-col justify-center p-6 sm:p-10">
              <p className="text-sm font-medium uppercase tracking-wider text-brand-600">
                Product Details
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                {product.name}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                {product.description}
              </p>
              <p className="mt-6 text-3xl font-bold text-brand-700">
                ${Number(product.price).toFixed(2)}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  onClick={handleAddToCart}
                  className={`btn-primary !px-8 !py-3 ${added ? "!bg-green-600 hover:!bg-green-600" : ""}`}
                >
                  {added ? "✓ Added to Cart" : "Add to Cart"}
                </button>
                <Link to="/cart" className="btn-secondary !px-8 !py-3">
                  View Cart
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default ProductDetails;
