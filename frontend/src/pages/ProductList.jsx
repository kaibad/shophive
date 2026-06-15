import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProductCard from "../components/ProductCard.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import EmptyState from "../components/EmptyState.jsx";

function ProductList() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchParams] = useSearchParams();

  const query = searchParams.get("q")?.toLowerCase() || "";
  const category = searchParams.get("category")?.toLowerCase() || "";

  const BASEURL = import.meta.env.VITE_DJANGO_BASE_URL;

  useEffect(() => {
    fetch(`${BASEURL}/api/products/`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch products");
        }
        return response.json();
      })
      .then((data) => {
        setProducts(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [BASEURL]);

  const filtered = products.filter((p) => {
    const matchesQuery =
      !query ||
      p.name.toLowerCase().includes(query) ||
      p.description?.toLowerCase().includes(query);
    const matchesCategory =
      !category ||
      p.category?.name?.toLowerCase().includes(category) ||
      p.name.toLowerCase().includes(category);
    return matchesQuery && matchesCategory;
  });

  if (loading) {
    return (
      <main className="page-main">
        <LoadingSpinner label="Loading products..." />
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-main px-4">
        <div className="mx-auto max-w-7xl">
          <EmptyState
            icon="⚠️"
            title="Something went wrong"
            description={error}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="page-main px-4 pb-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="section-title">Shop</h1>
          <p className="mt-1 text-sm text-slate-500">
            {category
              ? `Showing results for "${category}"`
              : query
                ? `Search results for "${query}"`
                : `${filtered.length} ${filtered.length === 1 ? "product" : "products"} available`}
          </p>
        </div>

        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="🔍"
            title="No products found"
            description="Try a different search or browse all products."
          />
        )}
      </div>
    </main>
  );
}

export default ProductList;
