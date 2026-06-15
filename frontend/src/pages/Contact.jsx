import { useState } from "react";

const CONTACT_INFO = [
  {
    icon: "✉️",
    label: "Email",
    value: "badukailash001@gmail.com",
    href: "mailto:badukailash001@gmail.com",
  },
  {
    icon: "📞",
    label: "Phone",
    value: "+977 9843952547",
    href: "tel:+9779843952547",
  },
  {
    icon: "📍",
    label: "Location",
    value: "Lalitpur, Nepal",
    href: null,
  },
  {
    icon: "💼",
    label: "LinkedIn",
    value: "kailash-badu",
    href: "https://www.linkedin.com/in/kailash-badu/",
  },
];

function Contact() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent(`ShopHive Contact from ${form.name}`);
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\n\n${form.message}`
    );
    window.location.href = `mailto:badukailash001@gmail.com?subject=${subject}&body=${body}`;
    setSubmitted(true);
  };

  return (
    <main className="page-main px-4 pb-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="section-title">Contact Me</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-slate-500">
            Have a question, project idea, or opportunity? I&apos;d love to hear
            from you. Drop a message or reach out directly.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* Contact cards */}
          <div className="space-y-4 lg:col-span-2">
            {CONTACT_INFO.map(({ icon, label, value, href }) => (
              <div key={label} className="card flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xl">
                  {icon}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand-500">
                    {label}
                  </p>
                  {href ? (
                    <a
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="mt-0.5 text-sm font-medium text-brand-900 transition-colors hover:text-brand-600"
                    >
                      {value}
                    </a>
                  ) : (
                    <p className="mt-0.5 text-sm font-medium text-brand-900">
                      {value}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* Map placeholder card */}
            <div className="card overflow-hidden">
              <div className="flex h-40 items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50">
                <div className="text-center">
                  <p className="text-3xl">🇳🇵</p>
                  <p className="mt-2 text-sm font-semibold text-brand-800">
                    Lalitpur, Nepal
                  </p>
                  <p className="text-xs text-slate-500">Bagmati Province</p>
                </div>
              </div>
            </div>
          </div>

          {/* Contact form */}
          <div className="card p-6 sm:p-8 lg:col-span-3">
            <h2 className="text-lg font-bold text-brand-900">Send a Message</h2>
            <p className="mt-1 text-sm text-slate-500">
              Fill out the form and it will open your email client ready to send.
            </p>

            {submitted ? (
              <div className="mt-8 rounded-xl bg-green-50 px-5 py-8 text-center">
                <p className="text-3xl">✅</p>
                <p className="mt-3 font-semibold text-green-800">
                  Your email client should open shortly!
                </p>
                <p className="mt-1 text-sm text-green-600">
                  If it didn&apos;t, email me directly at badukailash001@gmail.com
                </p>
                <button
                  onClick={() => setSubmitted(false)}
                  className="btn-secondary mt-5"
                >
                  Send Another
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-brand-800">
                    Your Name
                  </label>
                  <input
                    id="name"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    placeholder="John Doe"
                    className="input-field !rounded-xl"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-brand-800">
                    Your Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    placeholder="you@example.com"
                    className="input-field !rounded-xl"
                  />
                </div>
                <div>
                  <label htmlFor="message" className="mb-1.5 block text-sm font-medium text-brand-800">
                    Message
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    value={form.message}
                    onChange={handleChange}
                    required
                    rows={5}
                    placeholder="Tell me about your project or opportunity..."
                    className="input-field !rounded-xl resize-none"
                  />
                </div>
                <button type="submit" className="btn-primary w-full !py-3">
                  Send Message
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default Contact;
