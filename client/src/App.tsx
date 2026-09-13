import { useEffect, useRef, useState, createContext, useContext } from "react";
import { Link, NavLink, Routes, Route, useLocation } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { defaultContent, type SiteContent } from "../../shared/content";
import { InquiryForm, initialOffer } from "./Forms";
import { api } from "./api";
import Admin from "./Admin";
const Context = createContext({
  content: defaultContent,
  siteKey: "",
  offer: () => {},
});
export const useSite = () => useContext(Context);
function CTA({ className = "" }: { className?: string }) {
  const { content, offer } = useSite();
  return (
    <button className={`button ${className}`} onClick={offer}>
      {content.navigation.cta}
      <span aria-hidden="true">↗</span>
    </button>
  );
}
function FAQs({ preview = false }: { preview?: boolean }) {
  const { content } = useSite();
  return (
    <div className="faq-list">
      {content.faqs.items.slice(0, preview ? 3 : undefined).map((f, i) => (
        <details key={i}>
          <summary>
            {f.question}
            <span aria-hidden="true">+</span>
          </summary>
          <p>{f.answer}</p>
        </details>
      ))}
    </div>
  );
}
function Closing() {
  const { content: c } = useSite();
  return (
    <section className="closing forest">
      <div className="container">
        <p className="eyebrow">Your next chapter</p>
        <h2>{c.home.closingTitle}</h2>
        <p>{c.home.closingText}</p>
        <CTA />
      </div>
    </section>
  );
}
function Home() {
  const { content: c } = useSite();
  return (
    <>
      <section className="hero forest">
        <div className="hero-copy">
          <p className="eyebrow">{c.home.eyebrow}</p>
          <h1>{c.home.headline}</h1>
          <p className="hero-support">{c.home.support}</p>
          <div className="hero-actions">
            <CTA />
            <a href="#how-it-works" className="light-link">
              How it works <span aria-hidden="true">↓</span>
            </a>
          </div>
          <p className="reassurance">
            <span aria-hidden="true">✓</span> {c.home.reassurance}
          </p>
        </div>
        <div className="hero-visual">
          <img
            src={c.home.image}
            alt={c.home.imageAlt}
            width="1536"
            height="1024"
            fetchPriority="high"
          />
          <div className="image-note">
            <span className="small-caps">A home is more than a property.</span>
            <p>{c.home.imageCaption}</p>
          </div>
        </div>
      </section>
      <div className="values-strip">
        <div className="container">
          <span>{c.business.ownership}</span>
          <span>Serving Tampa Bay & surrounding communities</span>
          <span>Established {c.business.founded}</span>
        </div>
      </div>
      <section className="section container" id="how-it-works">
        <div className="section-heading">
          <p className="eyebrow">{c.home.processEyebrow}</p>
          <h2>{c.home.processTitle}</h2>
        </div>
        <div className="steps">
          {c.home.steps.map((s, i) => (
            <article key={i}>
              <span className="step-number">0{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="benefits-section">
        <div className="container split">
          <div>
            <p className="eyebrow">A sale that fits your life</p>
            <h2>{c.home.benefitsTitle}</h2>
            <p>{c.home.benefitsIntro}</p>
            <CTA />
          </div>
          <ul className="benefits">
            {c.home.benefits.map((b) => (
              <li key={b}>
                <span aria-hidden="true">✓</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="section container situations">
        <div className="section-heading">
          <p className="eyebrow">Meet life where it is</p>
          <h2>{c.home.situationsTitle}</h2>
          <p>{c.home.situationsIntro}</p>
        </div>
        <div className="situation-grid">
          {c.home.situations.map((s, i) => (
            <div key={s}>
              <span className="situation-index">0{i + 1}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="about-preview forest">
        <div className="container split">
          <div className="brand-panel">
            <img
              src={c.business.logo}
              alt={`${c.business.name} — ${c.business.tagline}`}
              width="1254"
              height="1254"
              loading="lazy"
            />
          </div>
          <div>
            <p className="eyebrow">Rooted in purpose</p>
            <h2>{c.home.introTitle}</h2>
            <p>{c.home.introText}</p>
            <Link className="light-link" to="/about">
              Get to know Kairos <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </section>
      <section className="section container split service">
        <div>
          <p className="eyebrow">Close to home</p>
          <h2>{c.home.serviceTitle}</h2>
          <p>{c.home.serviceText}</p>
        </div>
        <div className="area-list">
          {c.business.serviceAreas.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
      </section>
      <section className="faq-preview section">
        <div className="container split">
          <div>
            <p className="eyebrow">Before you take the next step</p>
            <h2>{c.home.faqTitle}</h2>
            <Link className="text-link" to="/faqs">
              Explore all FAQs ↗
            </Link>
          </div>
          <FAQs preview />
        </div>
      </section>
      <Closing />
    </>
  );
}
function About() {
  const { content: c } = useSite();
  return (
    <>
      <section className="page-hero forest">
        <div className="container">
          <p className="eyebrow">{c.about.eyebrow}</p>
          <h1>{c.about.title}</h1>
          <p>{c.about.intro}</p>
        </div>
      </section>
      <section className="section container split">
        <div className="brand-panel">
          <img
            src={c.business.logo}
            width="1254"
            height="1254"
            alt={c.business.name}
          />
        </div>
        <div>
          <p className="eyebrow">Our story</p>
          <h2>{c.about.storyTitle}</h2>
          <p>{c.about.story}</p>
          <p className="ownership">
            {c.business.ownership} · Established {c.business.founded}
          </p>
        </div>
      </section>
      <section className="section container values-cards">
        {c.about.values.map((v) => (
          <article key={v.title}>
            <h3>{v.title}</h3>
            <p>{v.text}</p>
          </article>
        ))}
      </section>
      {c.about.team.length > 0 && (
        <section className="section container">
          <h2>Meet the team</h2>
          <div className="values-cards">
            {c.about.team.map((t) => (
              <article key={t.name}>
                <h3>{t.name}</h3>
                <p>{t.role}</p>
                <p>{t.bio}</p>
              </article>
            ))}
          </div>
        </section>
      )}
      <Closing />
    </>
  );
}
function FAQPage() {
  const { content: c } = useSite();
  return (
    <>
      <section className="page-hero forest">
        <div className="container">
          <p className="eyebrow">Frequently asked questions</p>
          <h1>{c.faqs.title}</h1>
          <p>{c.faqs.intro}</p>
        </div>
      </section>
      <section className="section container narrow">
        <FAQs />
        <p className="after-faq">
          Have another question? <Link to="/contact">Let’s talk.</Link>
        </p>
      </section>
      <Closing />
    </>
  );
}
function Contact() {
  const { content: c, siteKey } = useSite();
  return (
    <section className="section container contact-layout">
      <div>
        <p className="eyebrow">Contact Kairos</p>
        <h1>{c.contact.title}</h1>
        <p>{c.contact.intro}</p>
        <div className="contact-details">
          <p>
            <span>Call us</span>
            <a href={`tel:${c.business.phone.replace(/[^+\d]/g, "")}`}>
              {c.business.phone}
            </a>
          </p>
          <p>
            <span>Email us</span>
            <a href={`mailto:${c.business.email}`}>{c.business.email}</a>
          </p>
          <p>
            <span>Our community</span>Tampa Bay & surrounding areas
          </p>
        </div>
        <div className="contact-note">
          <p>Ready to share your property?</p>
          <CTA />
        </div>
      </div>
      <div className="form-card">
        <InquiryForm content={c} siteKey={siteKey} contact />
      </div>
    </section>
  );
}
function Privacy() {
  const { content: c } = useSite();
  return (
    <section className="section container narrow">
      <p className="eyebrow">Your information</p>
      <h1>{c.privacy.title}</h1>
      <p className="notice">{c.privacy.status}</p>
      <p>Last updated: {c.privacy.updated}</p>
      {c.privacy.sections.map((s) => (
        <section className="privacy-section" key={s.title}>
          <h2>{s.title}</h2>
          <p>{s.text}</p>
        </section>
      ))}
      <p>
        Privacy questions:{" "}
        <a href={`mailto:${c.business.email}`}>{c.business.email}</a>
      </p>
    </section>
  );
}
function RouteEffects({ content }: { content: SiteContent }) {
  const location = useLocation();
  useEffect(() => {
    const key = (
      location.pathname === "/" ? "home" : location.pathname.slice(1)
    ) as keyof SiteContent["seo"];
    document.title = content.seo[key]?.title || "Kairos Legacy Homes";
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute("content", content.seo[key]?.description || "");
    window.scrollTo(0, 0);
  }, [location.pathname, content]);
  return null;
}
export default function App() {
  const [content, setContent] = useState(defaultContent);
  const [siteKey, setSiteKey] = useState("");
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [offerData, setOfferData] = useState(initialOffer);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const location = useLocation();
  useEffect(() => {
    api("/api/content")
      .then((r) => {
        setContent(r.content);
        setSiteKey(r.turnstileSiteKey);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    setMenu(false);
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    Object.entries(content.theme).forEach(([key, v]) =>
      document.documentElement.style.setProperty(`--${key}`, v),
    );
  }, [content]);
  const offer = () => {
    lastTrigger.current = document.activeElement as HTMLElement;
    setOpen(true);
  };
  const admin = location.pathname === "/admin";
  return (
    <Context.Provider value={{ content, siteKey, offer }}>
      <RouteEffects content={content} />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="header">
        <div className="nav-container">
          <Link to="/" className="brand" aria-label="Kairos Legacy Homes home">
            <img
              src={content.business.logo}
              alt="Kairos Legacy Homes"
              width="1254"
              height="1254"
            />
            <span>
              KAIROS<small>LEGACY HOMES</small>
            </span>
          </Link>
          <nav
            className={menu ? "navigation is-open" : "navigation"}
            id="primary-nav"
            aria-label="Main navigation"
          >
            {[
              ["/", content.navigation.home],
              ["/about", content.navigation.about],
              ["/faqs", content.navigation.faqs],
              ["/contact", content.navigation.contact],
            ].map(([url, label]) => (
              <NavLink end={url === "/"} key={url} to={url}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="desktop-cta">
            <CTA />
          </div>
          <button
            className="menu-button"
            aria-controls="primary-nav"
            aria-expanded={menu}
            aria-label={menu ? "Close navigation" : "Open navigation"}
            onClick={() => setMenu(!menu)}
          >
            {menu ? "✕" : "☰"}
          </button>
        </div>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/faqs" element={<FAQPage />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route
            path="/offer"
            element={
              <section className="section container offer-page">
                <p className="eyebrow">A straightforward start</p>
                <h1>{content.offer.title}</h1>
                <p>{content.offer.intro}</p>
                <div className="form-card">
                  <InquiryForm
                    content={content}
                    siteKey={siteKey}
                    data={offerData}
                    onChange={setOfferData}
                  />
                </div>
              </section>
            }
          />
          <Route path="/admin" element={<Admin onContent={setContent} />} />
          <Route
            path="*"
            element={
              <section className="section container">
                <h1>Let’s get you back home.</h1>
                <p>We couldn’t find that page.</p>
                <Link className="button" to="/">
                  Return home
                </Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer className="footer forest">
        <div className="container footer-grid">
          <div>
            <Link to="/" className="footer-name">
              {content.business.shortName}
            </Link>
            <p className="tagline">{content.business.tagline}</p>
            <p>{content.business.ownership}</p>
          </div>
          <div>
            <p className="eyebrow">Let’s connect</p>
            <a href={`tel:${content.business.phone.replace(/[^+\d]/g, "")}`}>
              {content.business.phone}
            </a>
            <a href={`mailto:${content.business.email}`}>
              {content.business.email}
            </a>
          </div>
          <div>
            <p className="eyebrow">Explore</p>
            <Link to="/about">About Us</Link>
            <Link to="/faqs">FAQs</Link>
            <Link to="/contact">Contact</Link>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>
            © {new Date().getFullYear()} {content.business.name}
          </span>
          <Link to="/privacy">Privacy Policy</Link>
          <span>No obligation. No guaranteed valuation.</span>
        </div>
      </footer>
      {!admin && (
        <div className="mobile-sticky">
          <CTA />
        </div>
      )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              lastTrigger.current?.focus();
            }}
          >
            <Dialog.Close
              className="dialog-close"
              aria-label="Close offer form"
            >
              ✕
            </Dialog.Close>
            <p className="eyebrow">Your next chapter starts here</p>
            <Dialog.Title>{content.offer.title}</Dialog.Title>
            <Dialog.Description>{content.offer.intro}</Dialog.Description>
            <InquiryForm
              content={content}
              siteKey={siteKey}
              data={offerData}
              onChange={setOfferData}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Context.Provider>
  );
}
