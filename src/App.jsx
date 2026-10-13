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
import "./styles.css";
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
function Contacts({ compact = false }) {
  const { data } = useSite();
  const p = data.profile;
  if (!p.address && !p.phone && !p.email && !p.socialUrl) return null;
  return (
    <div className={"contacts " + (compact ? "compact" : "")}>
      <div>
        <span>А.</span>
        <p>
          {p.address || "—"}
          {p.mapUrl && (
            <>
              <br />
              <a href={p.mapUrl} target="_blank" rel="noreferrer">
                Как добраться
              </a>
            </>
          )}
        </p>
      </div>
      <div>
        <span>К.</span>
        <p>
          {p.email ? <a href={"mailto:" + p.email}>{p.email}</a> : "—"}
          <br />
          {p.phone ? (
            <a href={"tel:" + p.phone.replace(/[^+\d]/g, "")}>{p.phone}</a>
          ) : (
            "—"
          )}
        </p>
      </div>
      <div>
        <span>С.</span>
        <p>
          {p.socialUrl ? (
            <a href={p.socialUrl} target="_blank" rel="noreferrer">
              Социальная сеть
            </a>
          ) : (
            "—"
          )}
        </p>
      </div>
    </div>
  );
}
function Header({ isHome }) {
  const { data, path, menu, setMenu } = useSite();
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef(null),
    lastFocus = useRef(null);
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
        className={`site-header ${scrolled ? "scrolled" : ""}`}
      >
        <Brand />
        <nav className="header-navigation" aria-label="Разделы сайта">
          <Link to="/about">Об Анне</Link>
          <Link to="/services">Услуги и цены</Link>
          <Link to="/diplomas">Дипломы</Link>
        </nav>
        <button
          className="small-link menu-trigger"
          onClick={() => setMenu(true)}
          aria-expanded={menu}
        >
          Меню
        </button>
        <Link className="small-link book-link" to="/contact">
          Запись<span> на приём</span>
        </Link>
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
        {!data.profile.address && !data.profile.phone && !data.profile.email && !data.profile.socialUrl && <p className="footer-contact-note">Контакты для записи пока не опубликованы.</p>}
        <div className="hours">
          <span className="eyebrow">Часы приёма</span>
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
      <Link to="/contact" className="footer-marquee">
        <span>
          Записаться на приём&nbsp;&nbsp;&nbsp; Записаться на
          приём&nbsp;&nbsp;&nbsp;{" "}
        </span>
        <span aria-hidden="true">
          Записаться на приём&nbsp;&nbsp;&nbsp; Записаться на
          приём&nbsp;&nbsp;&nbsp;{" "}
        </span>
      </Link>
    </footer>
  );
}
function HeroPortrait() {
  const { data, motion, setMotion } = useSite();
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const original = !data.profile.portrait || ["/media/anna-portrait.jpg", "/media/anna-portrait-smile.png"].includes(data.profile.portrait);
  useEffect(() => {
    const video = ref.current;
    if (!video || !original || failed) return;
    let visible = true;
    const sync = () => {
      if (motion && visible && !document.hidden) video.play().catch(() => setReady(false));
      else video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0.1 });
    observer.observe(video);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); video.pause(); };
  }, [motion, original, failed]);
  return <>
    <Portrait className="hero-image" loading="eager" fetchPriority="high" />
    {original && !failed && <video ref={ref} className={"hero-image hero-portrait-video" + (ready && motion ? " is-playing" : "")} src="/media/anna-portrait-calm.mp4" poster="/media/anna-portrait-smile.png" muted loop playsInline preload={motion ? "auto" : "none"} aria-hidden="true" onPlaying={() => setReady(true)} onError={() => setFailed(true)} />}
    {original && !failed && <button className="portrait-motion-toggle" onClick={() => setMotion(!motion)} aria-label={motion ? "Остановить анимацию портрета" : "Включить анимацию портрета"}><span aria-hidden="true">{motion ? "Ⅱ" : "▷"}</span><span>{motion ? "Пауза" : "Оживить портрет"}</span></button>}
  </>;
}
function Hero() {
  const { data } = useSite();
  const names = data.profile.name.trim().split(/\s+/);
  return (
    <section className="home-hero">
      <div className="hero-first">
        <HeroPortrait />
        <div className="hero-shade" />
        <div className="hero-title">
          <span className="eyebrow">{data.profile.role}</span>
          <h1><span>{names[0]}</span><span>{names.slice(1).join(" ")}</span></h1>
        </div>
        <div className="hero-bottom">
          <Link to="/diplomas" className="hero-document-link">Образование и дипломы</Link>
          <a href="#introduction" className="hero-scroll">Познакомиться <span aria-hidden="true">↓</span></a>
        </div>
      </div>
      <nav className="hero-chapters" aria-label="Навигация первого экрана">
        <Link to="/about"><span>01</span> Об Анне</Link>
        <Link to="/services"><span>02</span> Услуги и цены</Link>
        <Link to="/diplomas"><span>03</span> Дипломы</Link>
        <Link to="/contact"><span>04</span> Запись на приём</Link>
      </nav>
      <div className="hero-second">
        <Video />
        <div className="film-caption"><span className="eyebrow">Анна Мысливцева</span><p>В процессе<br />работы.</p><span className="eyebrow">Остеопатия</span></div>
      </div>
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
            Познакомиться.<br />
            Узнать больше.<br />
            Сделать свой выбор.
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
function FourSteps() {
  const { data, motion } = useSite();
  const [active, setActive] = useState(0),
    [pause, setPause] = useState(false);
  const start = useRef(0),
    content = useRef(null);
  useLayoutEffect(() => {
    const el = content.current;
    const resize = new ResizeObserver(() =>
      el.parentElement.style.setProperty(
        "--steps-height",
        el.offsetHeight + "px",
      ),
    );
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  const steps = [
    {
      title: "Об Анне",
      body: "Знакомство со специалистом: биография, образование и профессиональный путь.",
      to: "/about",
      image: data.profile.portrait,
    },
    {
      title: "Услуги и цены",
      body: "Направления работы, описание приёмов, их продолжительность и стоимость.",
      to: "/services",
      image: "/media/session-neutral-01.jpg",
    },
    {
      title: "Дипломы",
      body: "Дипломы и сертификаты — отдельная коллекция документов с просмотром в полном размере.",
      to: "/diplomas",
      image: data.profile.portrait,
    },
    {
      title: "Запись на приём",
      body: "Контакты, адрес и время приёма — всё необходимое, чтобы связаться с Анной.",
      to: "/contact",
      image: "/media/session-neutral-02.jpg",
    },
  ];
  useEffect(() => {
    if (!motion || pause) return;
    const t = setInterval(() => setActive((v) => (v + 1) % 4), 5000);
    return () => clearInterval(t);
  }, [motion, pause]);
  return (
    <section
      className="steps"
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
      onFocus={() => setPause(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPause(false);
      }}
      onTouchStart={(e) => (start.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const delta = e.changedTouches[0].clientX - start.current;
        if (Math.abs(delta) > 35)
          setActive((v) => (v + (delta < 0 ? 1 : 3)) % 4);
      }}
    >
      <div className="steps-content" ref={content}>
        <div className="step-heading">
          <span
            aria-hidden="true"
            key={active}
            className="step-progress"
            style={{
              "--progress-from": active / 4,
              "--progress-to": (active + 1) / 4,
              animationPlayState: pause || !motion ? "paused" : "running",
            }}
          />
          <span>{active + 1} : 4</span>
          <h2 className="eyebrow">Знакомство</h2>
          <div className="step-controls">
            {steps.map((_, i) => (
              <button
                key={i}
                className={active === i ? "selected" : ""}
                aria-label={`Слайд ${i + 1}`}
                aria-pressed={active === i}
                onClick={() => setActive(i)}
              />
            ))}
          </div>
        </div>
        <div className="step-track">
          {steps.map((s, i) => (
            <article
              key={s.to}
              className={`step ${i === active ? "active" : ""}`}
            >
              <button
                className="step-picture"
                onClick={() => setActive(i)}
                aria-label={s.title}
              >
                <img src={s.image} alt="" loading="lazy" />
              </button>
              <div className="step-copy">
                <span>({i + 1}).</span>
                <div>
                  <h3>
                    <Link to={s.to}>{s.title}</Link>
                  </h3>
                  <p>{s.body}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
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
              {kind === "philosophy" ? "Прежде чем записаться — познакомьтесь со специалистом и его образованием." : "Информация об услугах, стоимости и записи. В одном месте, в вашем ритме."}
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
      <h2 className="reveal">За каждым<br />приёмом —<br />человек.</h2>
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
          <span>Услуги и цены</span>
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
      <Intro />
      <FourSteps />
      <FullMedia />
      <Editorial />
      <Feature />
      <EducationFeature />
      <FullMedia single />
      <Editorial kind="approach" />
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
      {!data.news.length && !data.offers.length && <JournalLinks />}
      <PageLinks />
    </>
  );
}
function EducationFeature() {
  const { data } = useSite();
  return <section className="education-feature grid">
    <div className="education-heading"><span className="eyebrow">Образование и квалификация</span><h2 className="reveal">Образование<br />и дипломы.</h2></div>
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
      <PageHero first="Услуги" last="и стоимость." video />
      <section ref={section} className="service-section grid" id="services">
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
            <Video />
          )}
        </div>
      </section>
      <FullMedia single />
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
      <PageHero first="Анна" last="Мысливцева.">
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
        <div className="documents-empty"><span className="eyebrow">Публикации</span><h3>Документы ещё<br />не опубликованы.</h3><p>Здесь появятся дипломы и сертификаты Анны после загрузки.</p><Link to="/about" className="small-link">Вернуться к знакомству</Link></div>
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
      <PageHero first={title} last="Анны Мысливцевой." video />
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
  const p = data.profile;
  return (
    <>
      <PageHero first="Запись" last="на приём." />
      <section className="contact-section grid">
        <h2>
          Связаться
          <br />с Анной.
        </h2>
        <div>
          <Contacts />
          {p.hours && (
            <>
              <h3>Часы приёма</h3>
              <p className="pre-line">{p.hours}</p>
            </>
          )}
          {p.bookingUrl ? (
            <a
              className="solid-link"
              href={p.bookingUrl}
              target="_blank"
              rel="noreferrer"
            >
              Записаться на приём
            </a>
          ) : !p.phone && !p.email ? (
            <Empty>Контакты для записи скоро появятся.</Empty>
          ) : null}
        </div>
      </section>
    </>
  );
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
      <h1>Страница не найдена.</h1>
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
      <h1>Образование<br /><span>и дипломы.</span></h1>
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
    document.title =
      path === "/admin"
        ? "Панель управления · Анна Мысливцева"
        : (nav.find((x) => x[0] === path)?.[1] || "Анна Мысливцева") +
          " · Остеопат";
  }, [path]);
  useEffect(() => {
    if (!motion || path.startsWith("/admin")) return;
    const l = new Lenis({ duration: 1.15, smoothWheel: true });
    lenis.current = l;
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
    if (menu) lenis.current?.stop();
    else lenis.current?.start();
  }, [menu]);
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
