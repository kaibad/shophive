import { Link } from "react-router-dom";

function ProductCard({ product }) {
  const BASEURL = import.meta.env.VITE_DJANGO_BASE_URL;

  return (
    <Link to={`/product/${product.id}`} className="group block h-full">
      <article className="card flex h-full flex-col overflow-hidden transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-lg group-hover:shadow-brand-500/10">
        <div className="relative aspect-[4/3] overflow-hidden bg-stone-100">
          <img
            src={`${BASEURL}${product.image}`}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="flex flex-1 flex-col p-4">
          <h2 className="line-clamp-2 text-base font-semibold text-brand-900 group-hover:text-brand-600">
            {product.name}
          </h2>
          <p className="mt-auto pt-3 text-lg font-bold text-brand-600">
            ${Number(product.price).toFixed(2)}
          </p>
        </div>
      </article>
    </Link>
  );
}

export default ProductCard;
