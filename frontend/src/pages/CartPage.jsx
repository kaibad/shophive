import { useCart } from "../context/CartContext";
import { Link } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import BASEURL from "../config.js";

function CartPage() {
  const { cartItems, total, removeFromCart, updateQuantity } = useCart();

  return (
    <main className="page-main px-4 pb-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="section-title">Your Cart</h1>
          <p className="mt-1 text-sm text-slate-500">
            {cartItems.length === 0
              ? "No items yet"
              : `${cartItems.length} ${cartItems.length === 1 ? "item" : "items"} in your cart`}
          </p>
        </div>

        {cartItems.length === 0 ? (
          <EmptyState
            icon="🛒"
            title="Your cart is empty"
            description="Browse our products and add something you like."
            action={
              <Link to="/shop" className="btn-primary">
                Continue Shopping
              </Link>
            }
          />
        ) : (
          <div className="space-y-6">
            <div className="card divide-y divide-stone-100 overflow-hidden">
              {cartItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6"
                >
                  <div className="flex items-center gap-4">
                    {item.product_image && (
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-stone-100">
                        <img
                          src={`${BASEURL}${item.product_image}`}
                          alt={item.product_name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                    <div>
                      <h2 className="font-semibold text-slate-900">
                        {item.product_name}
                      </h2>
                      <p className="mt-0.5 text-sm text-slate-500">
                        ${Number(item.product_price).toFixed(2)} each
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <div className="flex items-center rounded-xl border border-stone-200 bg-stone-50">
                      <button
                        className="flex h-9 w-9 items-center justify-center text-lg font-medium text-slate-600 transition-colors hover:bg-stone-100 hover:text-slate-900"
                        onClick={() =>
                          updateQuantity(item.id, item.quantity - 1)
                        }
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="w-10 text-center text-sm font-semibold text-slate-900">
                        {item.quantity}
                      </span>
                      <button
                        className="flex h-9 w-9 items-center justify-center text-lg font-medium text-slate-600 transition-colors hover:bg-stone-100 hover:text-slate-900"
                        onClick={() =>
                          updateQuantity(item.id, item.quantity + 1)
                        }
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>

                    <p className="min-w-[4.5rem] text-right font-semibold text-slate-900">
                      ${(Number(item.product_price) * item.quantity).toFixed(2)}
                    </p>

                    <button
                      className="text-sm font-medium text-red-500 transition-colors hover:text-red-700"
                      onClick={() => removeFromCart(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="card p-6">
              <div className="flex items-center justify-between border-b border-stone-100 pb-4">
                <span className="text-base font-medium text-slate-600">
                  Subtotal
                </span>
                <span className="text-2xl font-bold text-slate-900">
                  ${total.toFixed(2)}
                </span>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Link to="/shop" className="btn-secondary text-center">
                  Continue Shopping
                </Link>
                <Link to="/checkout" className="btn-primary text-center">
                  Proceed to Checkout
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default CartPage;
