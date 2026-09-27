import { Link } from "react-router-dom";
import { LEGAL_ENTITY, LEGAL_VERSION, legalDocs, type LegalDoc } from "@/lib/legal";

/**
 * /terms, /refund-policy and /privacy — public, no sign-in, rendered from
 * src/lib/legal.ts so each document has one home. The version shown is the
 * one a buyer accepts on the Plans screen.
 */
export default function Legal({ slug }: { slug: LegalDoc["slug"] }) {
  const docs = legalDocs();
  const doc = docs.find((d) => d.slug === slug)!;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <a href="/" className="text-sm font-semibold text-primary hover:underline">{LEGAL_ENTITY.brand}</a>
        <h1 className="mt-4 text-3xl font-black" style={{ fontFamily: "var(--font-display)" }}>{doc.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Version {LEGAL_VERSION}</p>
        <nav className="mt-4 flex flex-wrap gap-3 text-sm" aria-label="Legal documents">
          {docs.map((d) => (
            <Link
              key={d.slug}
              to={`/${d.slug}`}
              aria-current={d.slug === slug ? "page" : undefined}
              className={d.slug === slug ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
            >
              {d.title}
            </Link>
          ))}
        </nav>
        <div className="mt-8 space-y-7">
          {doc.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-lg font-bold">{s.heading}</h2>
              {s.paragraphs.map((p, i) => (
                <p key={i} className="mt-2 text-sm leading-relaxed text-muted-foreground">{p}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
