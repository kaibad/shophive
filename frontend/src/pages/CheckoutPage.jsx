import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../utils/auth";
import { useCart } from "../context/CartContext";

function CheckoutPage() {
  const [form, setForm] = useState({
    name: "",
    address: "",
    phone: "",
    payment_method: "COD",
  });
  const [submitting, setSubmitting] = useState(false);

  const nav = useNavigate();
  const { clearCart, total } = useCart();
  const BASEURL = import.meta.env.VITE_DJANGO_BASE_URL;

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await authFetch(`${BASEURL}/api/orders/create/`, {
        method: "POST",
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (res.ok) {
        clearCart();
        alert("Order placed successfully!");
        nav("/");
      } else {
        alert(data.error || "Order failed");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      alert("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page-main px-4 pb-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-8">
          <h1 className="section-title">Checkout</h1>
          <p className="mt-1 text-sm text-slate-500">
            Complete your order details below
          </p>
        </div>

        <div className="card p-6 sm:p-8">
          {total > 0 && (
            <div className="mb-6 rounded-xl bg-brand-50 px-4 py-3 text-sm">
              <span className="text-slate-600">Order total: </span>
              <span className="font-bold text-brand-800">
                ${total.toFixed(2)}
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-700">
                Full Name
              </label>
              <input
                id="name"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="John Doe"
                required
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="address" className="mb-1.5 block text-sm font-medium text-slate-700">
                Delivery Address
              </label>
              <input
                id="address"
                name="address"
                value={form.address}
                onChange={handleChange}
                placeholder="123 Main St, City"
                required
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-700">
                Phone Number
              </label>
              <input
                id="phone"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="+1 234 567 8900"
                required
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="payment_method" className="mb-1.5 block text-sm font-medium text-slate-700">
                Payment Method
              </label>
              <select
                id="payment_method"
                name="payment_method"
                value={form.payment_method}
                onChange={handleChange}
                className="input-field"
              >
                <option value="COD">Cash on Delivery</option>
                <option value="ONLINE">Online Payment</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full !py-3"
            >
              {submitting ? "Placing Order..." : "Place Order"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default CheckoutPage;
