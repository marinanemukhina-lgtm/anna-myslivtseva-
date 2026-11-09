import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { initialContent } from "../shared/content.mjs";
import Admin from "./Admin.jsx";
import Booking from "./Booking.jsx";
import ContactActions from "./ContactActions.jsx";
import { ContactChoiceDialog } from "./ContactChoiceDialog.jsx";
import { OfficeDirections } from "./OfficeDirections.jsx";
import CallbackForm from "./CallbackForm.jsx";
import SocialLinks from "./SocialLinks.jsx";
import { contactMethods } from "./contact-methods.mjs";
import { publicSocialLinks, safePublicUrl } from "../shared/contact-links.mjs";
import "./styles.css";
import "./editorial.css";
import { callbackDocument } from "../shared/callbacks.mjs";
import { isDocumentScrollLocked } from "./dialog-scroll-lock.mjs";
gsap.registerPlugin(ScrollTrigger);
const Site = createContext(null);
export function useSite() {
  return useContext(Site);
}
export function Link({ to, children, className = "", ...props }) {
  const { navigate } = useSite();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          e.button === 0 &&
          to.startsWith("/")
        ) {
          e.preventDefault();
          navigate(to);
        }
      }}
      {...props}
    >
      {children}
    </a>
  );
}
export function Portrait({
  className = "",
  alt = "Анна Мысливцева",
  ...props
}) {
  const { data } = useSite();
  return (
    <img
      src={!data.profile.portrait || data.profile.portrait === "/media/anna-portrait.jpg" ? "/media/anna-portrait-smile.png" : data.profile.portrait}
      alt={alt}
      className={className}
      style={{ objectPosition: `50% ${data.profile.heroPosition ?? 0}%` }}
      {...props}
    />
  );
}
function Video({ second = false, className = "" }) {
  const ref = useRef(null);
  const { motion } = useSite();
  useEffect(() => {
    const el = ref.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && motion) el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.05 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [motion]);
  return (
    <video
      ref={ref}
      className={className}
      src={`/media/anna-session-neutral-0${second ? 2 : 1}.mp4`}
      poster={`/media/session-neutral-0${second ? 2 : 1}.jpg`}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label="Видео сеанса, предоставленное Анной"
    />
  );
}
function Brand({ light = false }) {
  const { data } = useSite();
  return (
    <Link
      to="/"
      className={"brand " + (light ? "light" : "")}
      aria-label="Анна Мысливцева — главная"
    >
      {data.profile.name || "Анна Мысливцева"}
    </Link>
  );
}
const nav = [
  ["/", "Главная"],
  ["/services", "Услуги и цены"],
  ["/about", "Об Анне"],
  ["/news", "Новости"],
  ["/offers", "Акции"],
  ["/diplomas", "Дипломы"],
  ["/contact", "Запись на приём"],
];
function Contacts({ compact = false, profile }) {
  const { data } = useSite();
  const p = profile || data.profile;
  const { phone, smsHref } = contactMethods(p);
  if (!p.address && !p.officeAddress && !phone && !p.email && !publicSocialLinks(p).length) return null;
  return <div className={"contacts " + (compact ? "compact" : "")}>
    {p.address && <div><span>Место приёма</span><p className="pre-line">{p.address}</p></div>}
    <OfficeDirections officeAddress={p.officeAddress} directionsUrl={p.directionsUrl} />
    {(phone || p.email) && <div><span>Для записи</span>
      {phone && <p><a href={"tel:" + phone}>{p.phone}</a></p>}
      {p.email && <p><a href={"mailto:" + p.email}>{p.email}</a></p>}
    </div>}
    {smsHref && <div><a href={smsHref}>Написать SMS <span aria-hidden="true">↗</span></a></div>}
    {publicSocialLinks(p).length > 0 && <div><SocialLinks profile={p} /></div>}
  </div>;
}
function Header({ isHome }) {
  const { data, path, menu, setMenu } = useSite();
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef(null),
    headerRef = useRef(null),
    lastFocus = useRef(null);
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => document.documentElement.style.setProperty("--header-height", Math.ceil(header.getBoundingClientRect().height) + "px");
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); document.documentElement.style.removeProperty("--header-height"); };
  }, []);
  useEffect(() => {
    const fn = () =>
      setScrolled(
        window.scrollY >
          80,
      );
    fn();
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, [path, isHome]);
  useEffect(() => {
    if (!menu) return;
    lastFocus.current = document.activeElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(
      () => ref.current?.querySelector("button")?.focus(),
      50,
    );
    const key = (e) => {
      if (e.key === "Escape") setMenu(false);
      if (e.key === "Tab") {
        const els = [...ref.current.querySelectorAll("a,button")].filter(
          (x) => x.offsetParent !== null,
        );
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", key);
      lastFocus.current?.focus();
    };
  }, [menu, setMenu]);
  return (
    <>
      <header
        ref={headerRef}
        className={`site-header ${scrolled || /^\/contact\/?$/.test(path) ? "scrolled" : ""} ${path === "/services" ? "site-header--petrol" : ""}`}
      >
        <Brand />
        <nav className="header-navigation" aria-label="Разделы сайта">
          <Link to="/about">Об Анне</Link>
          <Link to="/services">Услуги</Link>
          <Link to="/diplomas">Образование</Link>
          <Link to="/contact">Контакты</Link>
        </nav>
        <button
          className="small-link menu-trigger"
          aria-label="Меню"
          onClick={() => setMenu(true)}
          aria-expanded={menu}
        >
          Меню
        </button>
        <ContactChoiceDialog phone={data.profile.phone} triggerClassName="header-contact" />
      </header>
      <div
        className={"menu-backdrop " + (menu ? "visible" : "")}
        onClick={() => setMenu(false)}
      />
      <aside
        ref={ref}
        className={"menu-panel " + (menu ? "open" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Главное меню"
        inert={!menu ? true : undefined}
        aria-hidden={!menu}
      >
        <div className="menu-top">
          <Brand />
          <button onClick={() => setMenu(false)} className="small-link">
            Закрыть
          </button>
        </div>
        <nav aria-label="Основная навигация">
          {nav.map(([url, label], i) => (
            <Link key={url} to={url} className={path === url ? "current" : ""}>
              <span>{i + 1}.</span>
              {label}
            </Link>
          ))}
        </nav>
        <div className="menu-intro">
          <Portrait />
          <p>{data.profile.tagline || data.profile.name}</p>
        </div>
        <Contacts compact />
      </aside>
    </>
  );
}
function Footer() {
  const { data, motion, setMotion } = useSite();
  return (
    <footer className="footer">
      <p className="footer-tagline">{data.profile.name}<br /><span>{data.profile.role}</span></p>
      <div className="footer-grid">
        <Contacts />
        {!data.profile.address && !data.profile.officeAddress && !contactMethods(data.profile).phone && !data.profile.email && !publicSocialLinks(data.profile).length && <p className="footer-contact-note">Контакты для записи пока не опубликованы.</p>}
        <div className="hours">
          {data.profile.hours && <span className="eyebrow">Часы приёма</span>}
          {data.profile.hours ? (
            <p className="pre-line">{data.profile.hours}</p>
          ) : null}
        </div>
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} {data.profile.name}
        </span>
        <Link to="/diplomas">Дипломы</Link>
        <Link to="/privacy">Конфиденциальность</Link>
        <Link to="/terms">Условия использования</Link>
        <button onClick={() => setMotion(!motion)}>
          Анимация: {motion ? "вкл." : "выкл."}
        </button>
        <Link to="/admin">Вход</Link>
      </div>
      <Link to="/contact" className="small-link footer-contact-link">Связаться с Анной</Link>
      <Link to="/contact" className="footer-marquee"><span>Записаться на приём</span><span aria-hidden="true">↗</span></Link>
    </footer>
  );
}
function HeroPortrait() {
  const { data } = useSite();
  const p = data.profile;
  const custom = p.portrait && !["/media/anna-portrait.jpg", "/media/anna-portrait-smile.png"].includes(p.portrait);
  const src = p.heroPortrait || (custom ? p.portrait : "/media/anna-hero-petrol-clean-v1.png");
  return <img className={"hero-image" + (!p.heroPortrait && !custom ? " hero-image--stock" : " hero-image--custom")} src={src} alt={p.name} loading="eager" fetchPriority="high" style={p.heroPortrait || custom ? { objectPosition: `50% ${p.heroPosition ?? 0}%` } : undefined} />;
}
function Hero() {
  const { data } = useSite();
  const names = data.profile.name.trim().split(/\s+/);
  const services = data.services.filter(service => service.published);
  return (
    <section className="home-hero">
      <div className="hero-first">
        <HeroPortrait />
        <div className="hero-shade" />
        <div className="hero-title">
          <h1><span>{names[0]}</span><span>{names.slice(1).join(" ")}</span></h1>
          {data.profile.role && <p className="hero-role">{data.profile.role}</p>}
          {data.profile.address && <p className="hero-location pre-line">{data.profile.address}</p>}
          <div className="hero-actions">
            <ContactChoiceDialog phone={data.profile.phone} triggerClassName="hero-contact" />
            {services.length > 0 && <Link to="/services" className="hero-services">{services.some(service => service.price.trim()) ? "Услуги и стоимость" : "Услуги"}</Link>}
          </div>
        </div>
        <div className="hero-bottom">
          <Link to="/diplomas" className="hero-document-link">Образование и дипломы</Link>
          <Link to="/about" className="hero-scroll">Познакомиться <span aria-hidden="true">↗</span></Link>
        </div>
      </div>
      <nav className="hero-chapters" aria-label="Навигация первого экрана">
        <Link to="/services"><span>01</span> {services.some(service => service.price.trim()) ? "Услуги и цены" : "Услуги"}</Link>
        <Link to="/about"><span>02</span> Об Анне</Link>
        <Link to="/diplomas"><span>03</span> Дипломы</Link>
        <Link to="/contact"><span>04</span> Запись на приём</Link>
      </nav>
    </section>
  );
}
function Intro() {
  const { data } = useSite();
  return (
    <section className="intro grid" id="introduction">
      <Portrait className="intro-thumb" loading="lazy" />
      <h2 className="intro-title reveal">
        {data.profile.intro || (
          <>
            Познакомиться<br />
            Узнать больше<br />
            Сделать свой выбор
          </>
        )}
      </h2>
      <div className="intro-description">
        <p>
          {data.profile.about
            ? data.profile.about.split("\n")[0]
            : "Анна Мысливцева — остеопат. Здесь собраны сведения о специалисте, образовании, услугах и стоимости приёма."}
        </p>
        <Link to="/contact" className="small-link">
          Записаться на приём
        </Link>
      </div>
    </section>
  );
}
function FullMedia({ single = false }) {
  return (
    <section className={"full-media " + (single ? "single" : "split")}>
      <div className="full-media-inner" data-parallax>
        {single ? (
          <Video />
        ) : (
          <>
            <Portrait loading="lazy" />
            <Video />
          </>
        )}
      </div>
      <h2 className="media-label">
        <span>Анна</span>
        <span>Мысливцева</span>
        <span>Остеопат</span>
      </h2>
    </section>
  );
}
function Editorial({ kind = "philosophy" }) {
  const { data } = useSite();
  const copy =
    kind === "philosophy" ? data.profile.philosophy : data.profile.approach;
  return (
    <section
      className={
        "editorial grid " + (kind === "approach" ? "small-editorial" : "")
      }
    >
      <h2 className="eyebrow">
        {kind === "philosophy" ? "Личное знакомство" : "Перед приёмом"}
      </h2>
      <div>
        <h3 className="reveal">
          {copy || (
            <>
              {kind === "philosophy" ? "Прежде чем записаться — познакомьтесь со специалистом и его образованием" : "Информация об услугах, стоимости и записи. В одном месте, в вашем ритме"}
            </>
          )}
        </h3>
        {kind === "philosophy" && (
          <Link to="/services" className="small-link">
            Услуги и цены
          </Link>
        )}
      </div>
    </section>
  );
}
function Feature() {
  const { data } = useSite();
  return (
    <section className="feature grid">
      <h2 className="reveal">За каждым<br />приёмом —<br />человек</h2>
      <div className="feature-small">
        <Video second />
        <p>{data.profile.approach || "Познакомьтесь с Анной: биография и сведения об образовании собраны на отдельной странице."}</p>
        <Link to="/about" className="small-link">
          Подробнее
        </Link>
      </div>
      <div className="feature-big">
        <Video />
      </div>
    </section>
  );
}
function PageLinks() {
  const { data } = useSite();
  return (
    <section className="page-links grid">
      <h2 className="eyebrow">Продолжить знакомство</h2>
      <p>{data.profile.approach || "Выберите то, что хотите узнать сейчас: больше о специалисте или подробнее об услугах и стоимости."}</p>
      <div className="link-pictures">
        <Link to="/services">
          <img src="/media/session-neutral-01.jpg" alt="" loading="lazy" />
          <span>{data.services.some(service => service.published && service.price.trim()) ? "Услуги и цены" : "Услуги"}</span>
        </Link>
        <Link to="/about">
          <Portrait loading="lazy" />
          <span>Об Анне</span>
        </Link>
      </div>
    </section>
  );
}
function Home() {
  const { data } = useSite();
  return (
    <>
      <Hero />
      {data.profile.intro?.trim() && <section className="home-introduction" id="introduction"><p className="pre-line">{data.profile.intro}</p><Link to="/about" className="text-action">Об Анне <span aria-hidden="true">↗</span></Link></section>}
      {(data.news.length > 0 || data.offers.length > 0) && (
        <div className="home-updates">
          <h2 className="eyebrow">Новости и акции</h2>
          <div className="teasers">
            {[
              ...data.offers.slice(0, 2).map((x) => ({ ...x, type: "offers" })),
              ...data.news.slice(0, 2).map((x) => ({ ...x, type: "news" })),
            ].map((item) => (
              <Link key={item.type + item.id} to={`/${item.type}/${item.id}`}>
                <span className="eyebrow">
                  {item.type === "offers" ? "Акция" : "Новость"}
                </span>
                <h3>{item.title}</h3>
                {item.image && <img src={item.image} alt="" loading="lazy" />}
              </Link>
            ))}
          </div>
        </div>
      )}
      <section className="home-next editorial grid" aria-labelledby="home-next-title">
        <h2 id="home-next-title">Связаться с Анной</h2>
        <div>
          <p>Чтобы обсудить запись или задать организационный вопрос, выберите удобный способ связи.</p>
          <Link to="/contact" className="text-action">Перейти к контактам <span aria-hidden="true">↗</span></Link>
        </div>
      </section>
    </>
  );
}
function EducationFeature() {
  const { data } = useSite();
  return <section className="education-feature grid">
    <div className="education-heading"><span className="eyebrow">Образование и квалификация</span><h2 className="reveal">Образование<br />и дипломы</h2></div>
    <div className="education-description"><p>Дипломы и сертификаты Анны — в отдельном разделе. Каждый опубликованный документ можно рассмотреть в полном размере.</p><Link to="/diplomas" className="text-action">Посмотреть дипломы <span aria-hidden="true">↗</span></Link></div>
    <div className="education-foot"><span>{data.profile.name}</span><span>{data.diplomas.length ? `${data.diplomas.length} документов` : "Образование · Дипломы · Сертификаты"}</span></div>
  </section>;
}
function JournalLinks() {
  return <section className="journal-links grid">
    <h2 className="eyebrow">Актуальное</h2>
    <div><Link to="/news"><span>01</span><h3>Новости</h3><span aria-hidden="true">↗</span></Link><Link to="/offers"><span>02</span><h3>Акции</h3><span aria-hidden="true">↗</span></Link></div>
  </section>;
}
function PageHero({ first, last, video = false, children }) {
  return (
    <section className="page-hero">
      {video ? <Video /> : <Portrait loading="eager" />}
      <div className="page-hero-shade" />
      <h1>
        <span>{first}</span>
        <span>{last}</span>
      </h1>
      {children && <div className="hero-caption">{children}</div>}
    </section>
  );
}
function Empty({ children = "Информация скоро появится." }) {
  return <p className="empty-state">{children}</p>;
}
function Services() {
  const { data, motion } = useSite();
  const [active, setActive] = useState(0);
  const section = useRef(null),
    scroll = useRef(null);
  useLayoutEffect(() => {
    const media = gsap.matchMedia();
    media.add("(min-width: 1024px)", () => {
      if (data.services.length < 2 || data.services.length > 6 || !motion)
        return;
      const el = section.current;
      el.classList.add("scroll-services");
      el.style.setProperty("--service-count", data.services.length);
      const trigger = ScrollTrigger.create({
        trigger: el,
        start: "top 15%",
        end: "bottom 90%",
        onUpdate: (self) =>
          setActive(
            Math.min(
              data.services.length - 1,
              Math.floor(self.progress * data.services.length),
            ),
          ),
      });
      scroll.current = trigger;
      return () => {
        trigger.kill();
        scroll.current = null;
        el.classList.remove("scroll-services");
      };
    });
    return () => media.revert();
  }, [data.services, motion]);
  const select = (i) => {
    if (scroll.current) {
      const t = scroll.current;
      window.scrollTo({
        top: t.start + ((t.end - t.start) * (i + 0.25)) / data.services.length,
        behavior: "smooth",
      });
    }
    setActive(i);
  };
  return (
    <>
      <section className="services-editorial">
        <div className="services-editorial__copy">
          <span className="eyebrow">02 / Услуги</span>
          <h1>Услуги<br />и приём</h1>
          {!data.services.length && <p className="services-editorial__empty">Перечень услуг и цены<br />пока не опубликованы</p>}
          {data.profile.address && <p className="pre-line services-editorial__location">{data.profile.address}</p>}
          {contactMethods(data.profile).phone && <a className="services-editorial__phone" href={"tel:" + contactMethods(data.profile).phone}>{data.profile.phone}</a>}
        </div>
        <div className="services-editorial__media"><span className="eyebrow">В процессе работы</span><Video second /><p>Видео, предоставленное Анной</p></div>
        <ContactChoiceDialog phone={data.profile.phone} triggerLabel="Обсудить приём" triggerClassName="services-editorial__contact" />
      </section>
      <section ref={section} className="service-section grid" id="services" hidden={!data.services.length}>
        <nav className="section-index">
          <a href="#services" className="small-link">
            Услуги и цены
          </a>
          <Link to="/contact" className="small-link">
            Запись на приём
          </Link>
        </nav>
        <div className="service-list">
          <h2 className="service-lead">Услуги и цены</h2>
          {!data.services.length ? (
            <Empty>Перечень услуг и цены скоро появятся.</Empty>
          ) : (
            data.services.map((s, i) => (
              <article
                key={s.id}
                className={"service " + (active === i ? "active" : "")}
              >
                <button
                  className="service-title"
                  onClick={() => select(i)}
                  aria-expanded={active === i}
                  aria-controls={"service-" + s.id}
                >
                  <span>({i + 1}).</span>
                  <h3>{s.title}</h3>
                </button>
                <div
                  id={"service-" + s.id}
                  className="service-detail"
                  hidden={active !== i}
                >
                  <p className="pre-line">{s.body}</p>
                  <div className="service-meta">
                    {s.duration && <span>{s.duration}</span>}
                    {s.price && <span>{s.price}</span>}
                  </div>
                  <Link className="small-link" to="/contact">
                    Записаться
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
        <div className="service-visual">
          {data.services[active]?.image ? (
            <img
              src={data.services[active].image}
              alt={data.services[active].title}
            />
          ) : (
            <Video second />
          )}
        </div>
      </section>
      <Editorial />
      <PageLinks />
    </>
  );
}
function About() {
  const { data } = useSite();
  const p = data.profile;
  return (
    <>
      <PageHero first="Анна" last="Мысливцева">
        {p.role}
      </PageHero>
      <section className="about-intro editorial grid">
        <h2 className="eyebrow">Об Анне</h2>
        <div>
          <h3 className="reveal">{p.intro || p.name + " · " + p.role}</h3>
          <p className="pre-line biography">{p.about || "Биография Анны пока не опубликована."}</p>
        </div>
      </section>
      <section className="about-portrait grid">
        <Portrait loading="lazy" />
        <div>
          <span className="eyebrow">{p.role}</span>
          <h2>{p.name}</h2>
          {p.qualification && <p className="pre-line">{p.qualification}</p>}
          <Link to="/diplomas" className="small-link">
            Образование и дипломы
          </Link>
        </div>
      </section>
      <DiplomaGallery short />
      <PageLinks />
    </>
  );
}
function DiplomaGallery({ short = false }) {
  const { data } = useSite();
  const [opened, setOpened] = useState(null);
  const dialog = useRef(null);
  useEffect(() => {
    if (opened) {
      dialog.current?.showModal();
    }
  }, [opened]);
  return (
    <section className="diplomas-section">
      <div className="section-heading">
        <h2>{short ? "Образование и дипломы" : "Дипломы"}</h2>
        {short && (
          <Link to="/diplomas" className="small-link">
            Все документы
          </Link>
        )}
      </div>
      {!data.diplomas.length ? (
        <div className="documents-empty"><span className="eyebrow">Публикации</span><h3>Документы ещё<br />не опубликованы</h3><p>Здесь появятся дипломы и сертификаты Анны после загрузки.</p><Link to="/about" className="small-link">Вернуться к знакомству</Link></div>
      ) : (
        <div className="diploma-grid">
          {(short ? data.diplomas.slice(0, 3) : data.diplomas).map((d) => (
            <article key={d.id}>
              {d.fileType === "pdf" ? (
                <a
                  className="diploma-pdf"
                  href={d.image}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть документ · PDF
                </a>
              ) : (
                <button
                  onClick={() => setOpened(d)}
                  aria-label={"Открыть " + d.title}
                >
                  {d.image && (
                    <img src={d.image} alt={d.title} loading="lazy" />
                  )}
                </button>
              )}
              <h3>{d.title}</h3>
              <p>{[d.issuer, d.year].filter(Boolean).join(" · ")}</p>
              <p>{d.body}</p>
            </article>
          ))}
        </div>
      )}
      <dialog
        ref={dialog}
        className="lightbox"
        onClose={() => setOpened(null)}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <button
          onClick={() => dialog.current.close()}
          className="lightbox-close"
        >
          Закрыть
        </button>
        {opened && (
          <figure>
            <img src={opened.image} alt={opened.title} />
            <figcaption>{opened.title}</figcaption>
          </figure>
        )}
      </dialog>
    </section>
  );
}
function Listing({ type, id }) {
  const { data, ready } = useSite();
  if (id && !ready)
    return (
      <section className="article-page" role="status">
        Загрузка…
      </section>
    );
  const title = type === "news" ? "Новости" : "Акции";
  const list = data[type];
  const item = id ? list.find((x) => x.id === id) : null;
  if (id && !item) return <NotFound />;
  return item ? (
    <>
      <section className="article-page">
        <Link to={"/" + type} className="small-link">
          Вернуться · {title}
        </Link>
        <div className="article-heading">
          <span className="eyebrow">
            {title}
            {item.date ? " · " + formatDate(item.date) : ""}
          </span>
          <h1>{item.title}</h1>
        </div>
        {item.image && (
          <img className="article-cover" src={item.image} alt={item.title} />
        )}
        <div className="article-body">
          <p className="pre-line">{item.body}</p>
          {item.price && <h2>{item.price}</h2>}
          {item.until && <p>Действует до {formatDate(item.until)}</p>}
          {item.conditions && <p className="pre-line">{item.conditions}</p>}
          {type === "offers" && (
            <Link to="/contact" className="small-link">
              Записаться на приём
            </Link>
          )}
        </div>
      </section>
    </>
  ) : (
    <>
      <PageHero first={title} last="Анны Мысливцевой" video />
      <section className="listing-section">
        <div className="section-heading">
          <h2>{title}</h2>
          <span className="eyebrow">
            {list.length ? String(list.length).padStart(2, "0") : ""}
          </span>
        </div>
        {list.length ? (
          <div className="teasers">
            {list.map((x) => (
              <Link to={`/${type}/${x.id}`} key={x.id}>
                {x.image && <img src={x.image} alt="" loading="lazy" />}
                <span className="eyebrow">
                  {x.date ? formatDate(x.date) : title}
                </span>
                <h3>{x.title}</h3>
                {x.price && <p>{x.price}</p>}
                <p>
                  {x.body.slice(0, 150)}
                  {x.body.length > 150 ? "…" : ""}
                </p>
                <span className="small-link">Читать</span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>
            {type === "news"
              ? "Новостей пока нет."
              : "Актуальных акций пока нет."}
          </Empty>
        )}
      </section>
    </>
  );
}
function formatDate(s) {
  const date = new Date(s);
  return Number.isNaN(date.getTime())
    ? s
    : date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}
function Contact() {
  const { data } = useSite();
  const p = Object.fromEntries(Object.entries(data.profile).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
  return <><ContactActions profile={p} /><CallbackForm profile={p} /></>;
}
function CallbackConsentPage() {
  const { data } = useSite();
  const doc = callbackDocument(data.profile);
  return <section className="legal-page"><h1>Согласие на обработку телефона</h1>
    {doc ? <><p>Версия: {doc.version}</p><h2>Оператор</h2><p>{doc.operatorName}</p><p className="pre-line">{doc.operatorDetails}</p><p className="pre-line">{doc.text}</p></> : <p>Проверенный документ пока не опубликован. Приём заявок на обратный звонок недоступен.</p>}
    <Link to="/contact">К контактам</Link>
  </section>;
}
function Legal({ type }) {
  const { data } = useSite();
  return (
    <section className="legal-page">
      <h1>
        {type === "privacy" ? "Конфиденциальность" : "Условия использования"}
      </h1>
      {data.profile[type] ? (
        <p className="pre-line">{data.profile[type]}</p>
      ) : (
        <Empty>Информация скоро появится.</Empty>
      )}
    </section>
  );
}
function NotFound() {
  return (
    <section className="not-found">
      <span className="eyebrow">404</span>
      <h1>Страница не найдена</h1>
      <Link to="/" className="small-link">
        На главную
      </Link>
    </section>
  );
}
function Diplomas() {
  const { data } = useSite();
  return <>
    <section className="documents-hero grid">
      <span className="eyebrow">Анна Мысливцева / Образование</span>
      <h1>Образование<br /><span>и дипломы</span></h1>
      <Portrait loading="eager" />
      <div><p>{data.profile.qualification || "Дипломы, сертификаты и сведения об образовании специалиста."}</p><a href="#documents" className="text-action">К документам <span aria-hidden="true">↓</span></a></div>
    </section>
    <div id="documents"><DiplomaGallery /></div>
    <JournalLinks />
  </>;
}
function Page() {
  const { path } = useSite();
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return <Home />;
  if (parts[0] === "services") return <Services />;
  if (parts[0] === "about") return <About />;
  if (parts[0] === "diplomas")
    return <Diplomas />;
  if (["news", "offers"].includes(parts[0]))
    return <Listing type={parts[0]} id={parts[1]} />;
  if (parts[0] === "contact") return <Contact />;
  if (parts[0] === "callback-consent") return <CallbackConsentPage />;
  if (["privacy", "terms"].includes(parts[0])) return <Legal type={parts[0]} />;
  return <NotFound />;
}
export default function App() {
  const [path, setPath] = useState(window.location.pathname),
    [data, setData] = useState(initialContent),
    [menu, setMenu] = useState(false),
    [error, setError] = useState(""),
    [motion, setMotion] = useState(
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  const [ready, setReady] = useState(false);
  const root = useRef(null),
    lenis = useRef(null);
  const load = () =>
    fetch("/api/content")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((x) => {
        setData(x);
        setError("");
      })
      .catch(() =>
        setError("Не удалось обновить информацию. Попробуйте позже."),
      )
      .finally(() => setReady(true));
  useEffect(() => {
    load();
    const pop = () => {
      setPath(window.location.pathname);
      setMenu(false);
    };
    window.addEventListener("popstate", pop);
    const focus = () => load();
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("focus", focus);
    };
  }, []);
  const navigate = (to) => {
    if (to === path) {
      setMenu(false);
      return;
    }
    history.pushState({}, "", to);
    setMenu(false);
    setPath(to);
    window.scrollTo(0, 0);
    load();
  };
  useEffect(() => {
    document.documentElement.lang = "ru";
    const articlePath = /^\/(news|offers)\/[^/]+$/.test(path);
    if (articlePath && (!ready || error)) return;
    const articleType = path.split("/")[1];
    const article = articlePath ? data[articleType].find(item => path === `/${articleType}/${item.id}`) : null;
    document.title = article?.title || (
      path === "/admin"
        ? "Панель управления · Анна Мысливцева"
        : (nav.find((x) => x[0] === path)?.[1] || "Анна Мысливцева") +
          " · Остеопат");
  }, [path, data, ready, error]);
  useEffect(() => {
    if (!motion || path.startsWith("/admin")) return;
    const l = new Lenis({ duration: 1.15, smoothWheel: true });
    lenis.current = l;
    if (menu || isDocumentScrollLocked(document)) l.stop();
    l.on("scroll", ScrollTrigger.update);
    const tick = (t) => l.raf(t * 1000);
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      l.destroy();
      lenis.current = null;
    };
  }, [motion, path]);
  useEffect(() => {
    const sync = () => {
      if (menu || isDocumentScrollLocked(document)) lenis.current?.stop();
      else lenis.current?.start();
    };
    document.addEventListener("anna:dialog-scroll-lock", sync);
    sync();
    return () => document.removeEventListener("anna:dialog-scroll-lock", sync);
  }, [menu, motion, path]);
  useLayoutEffect(() => {
    if (path.startsWith("/admin")) return;
    const ctx = gsap.context(() => {
      if (!motion) return;
      gsap.utils.toArray(".reveal").forEach((el) =>
        gsap.fromTo(
          el,
          { y: 24, opacity: 0.65 },
          {
            y: 0,
            opacity: 1,
            duration: 1.2,
            ease: "power3.out",
            scrollTrigger: {
              trigger: el,
              start: "top 95%",
              end: "top 62%",
              scrub: 0.7,
            },
          },
        ),
      );
      gsap.utils.toArray("[data-parallax]").forEach((el) =>
        gsap.fromTo(
          el,
          { yPercent: -5 },
          {
            yPercent: 5,
            ease: "none",
            scrollTrigger: {
              trigger: el.parentElement,
              start: "top bottom",
              end: "bottom top",
              scrub: true,
            },
          },
        ),
      );
      gsap.utils.toArray(".feature-big").forEach((el) =>
        gsap.fromTo(
          el,
          { scaleX: 0.8, transformOrigin: "left center" },
          {
            scaleX: 1,
            ease: "none",
            scrollTrigger: {
              trigger: el,
              start: "top bottom",
              end: "center center",
              scrub: 0.8,
            },
          },
        ),
      );
    }, root);
    const t = setTimeout(() => ScrollTrigger.refresh(), 600);
    return () => {
      clearTimeout(t);
      ctx.revert();
    };
  }, [path, motion, data]);
  const admin = path.startsWith("/admin");
  useEffect(() => {
    // Keep server metadata while a published article is still loading or fetch fails.
    if (/^\/(news|offers)\/[^/]+$/.test(path) && (!ready || error)) return;
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.remove();
    const isPublic = nav.some(([url]) => url === path) || ["/privacy", "/terms"].includes(path) || ["news", "offers"].some(type => data[type].some(item => path === `/${type}/${item.id}`));
    document.querySelectorAll('meta[name="robots"]').forEach(node => node.remove());
    if (!isPublic) {
      const robots = document.createElement("meta");
      robots.name = "robots";
      robots.content = "noindex, nofollow";
      document.head.appendChild(robots);
    }
    if (isPublic) {
      const link = document.createElement("link");
      link.rel = "canonical";
      link.href = "https://anna-myslivtseva.vercel.app" + path;
      document.head.appendChild(link);
    }
  }, [path, data, ready, error]);
  return (
    <Site.Provider
      value={{
        path,
        navigate,
        data,
        ready,
        setData,
        menu,
        setMenu,
        motion,
        setMotion,
        load,
      }}
    >
      <div ref={root} className={motion ? "motion-on" : "motion-off"}>
        {admin ? (
          <Admin />
        ) : (
          <>
            <a href="#main" className="skip-link">
              К содержимому
            </a>
            <Header isHome={path === "/"} />
            {error && (
              <div className="load-error" role="status">
                {error}
              </div>
            )}
            <main id="main" key={path} className="page-enter">
              <Page />
            </main>
            <Footer />
          </>
        )}
      </div>
    </Site.Provider>
  );
}
