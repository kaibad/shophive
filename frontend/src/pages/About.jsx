import { Link } from "react-router-dom";

const SKILLS = [
  "Python & Django",
  "PostgreSQL",
  "Docker & Containers",
  "CI/CD Pipelines",
  "Linux Administration",
  "Cloud Infrastructure",
  "Git & GitHub Actions",
  "React & REST APIs",
];

const HIGHLIGHTS = [
  {
    title: "DevOps Intern @ Codavatar",
    desc: "Managing deployment workflows, containerized environments, and infrastructure automation for production-grade applications.",
  },
  {
    title: "B.Sc. Computer Science",
    desc: "Pursuing a Bachelor's in Computer & Information Sciences at Tribhuvan University, Lalitpur.",
  },
  {
    title: "DevOps Training",
    desc: "Intensive hands-on program covering AWS, Kubernetes, Terraform, monitoring, and modern CI/CD practices.",
  },
];

function About() {
  return (
    <main className="page-main">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-10 h-56 w-56 rounded-full bg-white/5 blur-2xl" />
        <div className="relative mx-auto max-w-4xl text-center">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-4xl ring-4 ring-white/20">
            👨‍💻
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
            Kailash Badu
          </h1>
          <p className="mt-3 text-lg font-medium text-brand-200 sm:text-xl">
            Backend Developer & DevOps Engineer
          </p>
          <p className="mx-auto mt-2 flex items-center justify-center gap-1.5 text-sm text-brand-300">
            📍 Lalitpur, Nepal
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 lg:px-8">
        {/* Bio */}
        <section className="card p-8 sm:p-10">
          <h2 className="section-title">About Me</h2>
          <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
            <p>
              Hey, I&apos;m <strong className="text-brand-800">Kailash Badu</strong> — a
              Backend Developer & DevOps Engineer based in Lalitpur, Nepal. I love
              building reliable systems that scale, from robust REST APIs to automated
              deployment pipelines that keep applications running smoothly in production.
            </p>
            <p>
              Currently, I&apos;m working at{" "}
              <strong className="text-brand-800">Codavatar</strong> as a DevOps Intern,
              where I help streamline deployment workflows, manage containerized
              environments with Docker, and support CI/CD pipelines that ship code
              faster and safer. I work closely with development teams to bridge the gap
              between writing great software and getting it live in the cloud.
            </p>
            <p>
              I&apos;m pursuing my Bachelor&apos;s in Computer & Information Sciences at{" "}
              <strong className="text-brand-800">Tribhuvan University</strong>, alongside
              an intensive DevOps training program — actively building skills in cloud
              infrastructure, CI/CD pipelines, infrastructure-as-code, and automation.
              Every project I take on is a chance to learn something new and push my
              craft further.
            </p>
            <p>
              This ShopHive project is a full-stack e-commerce platform I built to
              showcase my skills end-to-end: a Django + PostgreSQL backend with JWT
              authentication, cart & order management, and a React frontend with a
              modern shopping experience. It reflects how I think about clean
              architecture, API design, and user-focused development.
            </p>
            <p className="font-medium text-brand-800">
              Highly motivated to grow into a dedicated DevOps & Cloud Engineering
              career — always learning, always building.
            </p>
          </div>
        </section>

        {/* Highlights */}
        <section className="mt-10 grid gap-5 sm:grid-cols-3">
          {HIGHLIGHTS.map(({ title, desc }) => (
            <div
              key={title}
              className="card p-6 transition-shadow hover:shadow-md"
            >
              <h3 className="font-bold text-brand-800">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{desc}</p>
            </div>
          ))}
        </section>

        {/* Skills */}
        <section className="mt-10">
          <h2 className="section-title">Skills & Technologies</h2>
          <div className="mt-5 flex flex-wrap gap-3">
            {SKILLS.map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800"
              >
                {skill}
              </span>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mt-10 rounded-[1.75rem] bg-gradient-to-r from-brand-800 to-brand-500 px-8 py-10 text-center text-white">
          <h2 className="text-xl font-bold sm:text-2xl">
            Let&apos;s connect and build something great
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-brand-100">
            Open to collaborations, internships, and DevOps opportunities.
          </p>
          <Link
            to="/contact"
            className="mt-5 inline-flex rounded-full bg-white px-8 py-3 text-sm font-bold text-brand-800 transition hover:bg-brand-50"
          >
            Get in Touch
          </Link>
        </section>
      </div>
    </main>
  );
}

export default About;
