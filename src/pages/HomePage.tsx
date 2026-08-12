import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Buildings,
  CalendarCheck,
  Check,
  CheckCircle,
  FileLock,
  FolderOpen,
  HouseLine,
  LinkSimple,
  List,
  LockKey,
  MapPin,
  NotePencil,
  ShieldCheck,
  UsersThree,
  WhatsappLogo,
  X,
} from '@phosphor-icons/react'

const faqItems = [
  {
    question: '¿Puedo cancelar durante la prueba?',
    answer:
      'Sí. Puedes cancelar en cualquier momento desde Facturación. Verás la fecha exacta del primer cargo antes de confirmar el plan.',
  },
  {
    question: '¿Cómo funciona el enlace de cada inmueble?',
    answer:
      'Al publicar un anuncio, Inquilink genera un enlace único. Puedes copiarlo en un clic y añadirlo a cualquier portal inmobiliario o compartirlo por WhatsApp.',
  },
  {
    question: '¿Los inquilinos necesitan crear una cuenta?',
    answer:
      'Sí. Cada interesado crea una cuenta o inicia sesión antes de completar la solicitud. Así puede guardar el progreso y consultar sus candidaturas con seguridad.',
  },
  {
    question: '¿Qué documentación pueden enviar?',
    answer:
      'Puedes solicitar nóminas, contratos laborales, justificantes para autónomos y otros documentos de solvencia en PDF, JPG o PNG.',
  },
  {
    question: '¿Puedo trabajar con mi equipo?',
    answer:
      'Sí. Profesional permite hasta 3 cuentas e Inmobiliaria incluye cuentas ilimitadas. Particular está limitado a una cuenta de administrador.',
  },
]

const pricingPlans = [
  {
    id: 'particular',
    name: 'Particular',
    price: '9,99 €',
    description: 'Para propietarios que gestionan uno o dos alquileres.',
    limits: ['Hasta 2 anuncios simultáneos', '1 cuenta de administrador'],
    featured: false,
  },
  {
    id: 'professional',
    name: 'Profesional',
    price: '49,99 €',
    description: 'Para profesionales y pequeñas agencias que trabajan en equipo.',
    limits: ['Hasta 15 anuncios simultáneos', 'Hasta 3 cuentas en total'],
    featured: true,
  },
  {
    id: 'inmobiliaria',
    name: 'Inmobiliaria',
    price: '99,99 €',
    description: 'Para inmobiliarias con una cartera y un equipo amplios.',
    limits: ['Hasta 100 anuncios simultáneos', 'Cuentas ilimitadas para todo tu equipo'],
    featured: false,
  },
] as const

const workflow = [
  {
    icon: Buildings,
    title: 'Crea el anuncio',
    text: 'Añade el inmueble y elige qué documentación necesitas.',
    image: '/assets/workflow-create.webp',
    fallback: '/assets/workflow-create.png',
    alt: 'Agente inmobiliaria preparando la ficha y los requisitos de un inmueble',
  },
  {
    icon: LinkSimple,
    title: 'Comparte el enlace',
    text: 'Publica un enlace único en tus portales y canales.',
    image: '/assets/workflow-share.webp',
    fallback: '/assets/workflow-share.png',
    alt: 'Agente compartiendo el enlace de un inmueble desde el móvil',
  },
  {
    icon: UsersThree,
    title: 'Recibe candidatos',
    text: 'Cada solicitud llega directamente al inmueble correcto.',
    image: '/assets/workflow-receive.webp',
    fallback: '/assets/workflow-receive.png',
    alt: 'Candidatos enviando sus solicitudes al inmueble correcto',
  },
  {
    icon: List,
    title: 'Gestiona el proceso',
    text: 'Compara, contacta y agenda sin cambiar de herramienta.',
    image: '/assets/workflow-manage.webp',
    fallback: '/assets/workflow-manage.png',
    alt: 'Agente organizando candidatos, mensajes y visitas en un mismo proceso',
  },
]

const previewApplicants = [
  { initials: 'LM', name: 'Lucía Martín', detail: 'lucia.martin@email.es · 3.450 € / mes', status: 'Nuevo', tone: 'nuevo', avatar: 0 },
  { initials: 'DR', name: 'Diego Ramos', detail: 'diego.ramos@email.es · Documentación completa', status: 'Preseleccionado', tone: 'preseleccionado', avatar: 1 },
  { initials: 'SN', name: 'Sara Navarro', detail: 'sara.navarro@email.es · Visita: 12/09, 18:30', status: 'Seleccionado', tone: 'seleccionado', avatar: 2 },
  { initials: 'CR', name: 'Claudia Reyes', detail: 'claudia.reyes@email.es · 4.500 € / mes', status: 'Nuevo', tone: 'nuevo', avatar: 0 },
]

function Logo() {
  return (
    <a className="brand" href="/" aria-label="Inquilink, página de inicio">
      <span className="brand-mark" aria-hidden="true">i</span>
      Inquilink
    </a>
  )
}

function Header() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  return (
    <header className="site-header">
      <nav className="nav-shell" aria-label="Navegación principal">
        <Logo />
        <button
          className="nav-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <X aria-hidden="true" /> : <List aria-hidden="true" />}
        </button>
        <div className="nav-links" id="desktop-navigation">
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#funciones">Funciones</a>
          <a href="#precios">Precios</a>
          <a href="#preguntas">Preguntas frecuentes</a>
        </div>
        <div className="nav-actions">
          <a className="button button-ghost" href="/iniciar-sesion">Iniciar sesión</a>
          <a className="button button-dark button-small" href="/registro">Pruébalo ahora</a>
        </div>
      </nav>
      {open && (
        <div className="mobile-nav" id="mobile-navigation">
          <a href="#como-funciona" onClick={() => setOpen(false)}>Cómo funciona</a>
          <a href="#funciones" onClick={() => setOpen(false)}>Funciones</a>
          <a href="#precios" onClick={() => setOpen(false)}>Precios</a>
          <a href="#preguntas" onClick={() => setOpen(false)}>Preguntas frecuentes</a>
          <a href="/iniciar-sesion">Iniciar sesión</a>
          <a className="button button-dark" href="/registro">Pruébalo ahora</a>
        </div>
      )}
    </header>
  )
}

function ListingPreview() {
  return (
    <div className="app-preview listing-preview" aria-label="Vista de un anuncio dentro de Inquilink">
      <header className="listing-preview__header">
        <span className="listing-preview__visual" aria-hidden="true">
          <span className="listing-preview__sun" />
          <span className="listing-preview__building listing-preview__building--back" />
          <span className="listing-preview__building listing-preview__building--front" />
          <HouseLine weight="duotone" />
        </span>
        <div className="listing-preview__identity">
          <div>
            <span className="listing-preview__reference">MAD-042</span>
            <span className="listing-preview__badge listing-preview__badge--publicado">Publicado</span>
          </div>
          <h3>Piso luminoso en Chamberí</h3>
          <p><MapPin aria-hidden="true" /> Calle de Galileo, 41, Madrid · 1.450 € / mes</p>
        </div>
        <div className="listing-preview__stats">
          <span><strong>8</strong><small>interesados</small></span>
          <span><strong>4</strong><small>nuevos</small></span>
          <span><strong>5</strong><small>por revisar</small></span>
        </div>
      </header>
      <div className="listing-preview__section">
        <span><strong>Interesados</strong><small>4 resultados visibles</small></span>
      </div>
      <ul className="listing-preview__list">
        {previewApplicants.map((applicant) => (
          <li key={applicant.name}>
            <span className={`listing-preview__avatar listing-preview__avatar--${applicant.avatar}`} aria-hidden="true">{applicant.initials}</span>
            <span className="listing-preview__person">
              <strong>{applicant.name}</strong>
              <small>{applicant.detail}</small>
            </span>
            <span className={`listing-preview__badge listing-preview__badge--${applicant.tone}`}>{applicant.status}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PricingCard({ plan }: { plan: (typeof pricingPlans)[number] }) {
  return (
    <article className={plan.featured ? 'pricing-card pricing-card-featured' : 'pricing-card'}>
      <div className="pricing-name">
        <h3>{plan.name}</h3>
        {plan.featured && <span>Más elegido</span>}
      </div>
      <p className="price"><strong>{plan.price}</strong> <span>/ mes</span></p>
      <p>{plan.description}</p>
      <a className="button button-dark" href={`/registro?plan=${plan.id}`}>
        Pruébalo ahora <ArrowRight aria-hidden="true" />
      </a>
      <ul className="pricing-features">
        {plan.limits.map((feature) => (
          <li key={feature}><Check aria-hidden="true" /> {feature}</li>
        ))}
        <li><Check aria-hidden="true" /> Todas las funciones de Inquilink</li>
      </ul>
    </article>
  )
}

export function HomePage() {
  return (
    <div className="site-page">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <Header />
      <main id="contenido">
        <section className="hero" aria-labelledby="hero-title">
          <div className="page-shell hero-grid">
            <div className="hero-copy">
              <p className="hero-eyebrow">El Portal de Inquilinos para Inmobiliarias y Particulares</p>
              <h1 id="hero-title"><span>Cientos de inquilinos.</span><span>Un solo portal.</span></h1>
              <p className="hero-support">Centraliza los interesados, la documentación y las visitas de cada inmueble en un único lugar.</p>
              <div className="hero-actions">
                <a className="button button-dark button-large" href="/registro">Pruébalo ahora <ArrowRight aria-hidden="true" /></a>
              </div>
            </div>
            <div className="hero-visual">
              <picture>
                <source media="(max-width: 767px)" srcSet="/assets/inquilink-hero-768.webp" type="image/webp" />
                <source srcSet="/assets/inquilink-hero.webp" type="image/webp" />
                <img
                  src="/assets/inquilink-hero.png"
                  alt="Candidatos entregando sus solicitudes a una agente frente a un edificio de alquiler"
                  width="1536"
                  height="1024"
                  fetchPriority="high"
                />
              </picture>
              <article className="hero-product-preview" aria-label="Vista previa del portal">
                <span className="hero-preview-icon"><Buildings aria-hidden="true" /></span>
                <span><strong>Ático en Chamberí</strong><small>3 candidatos nuevos</small></span>
                <a href="/iniciar-sesion" aria-label="Ver interesados del inmueble de ejemplo"><ArrowRight aria-hidden="true" /></a>
              </article>
            </div>
          </div>
        </section>

        <section className="problem-section" aria-labelledby="problem-title">
          <div className="page-shell problem-layout">
            <h2 id="problem-title">Ponle fin a cientos de llamadas dispersas. Llama únicamente a los interesados que tú elijas</h2>
            <div className="problem-video-slot" aria-label="Espacio reservado para un vídeo" />
          </div>
        </section>

        <section className="workflow-section section-space" id="como-funciona" aria-labelledby="workflow-title">
          <div className="page-shell">
            <div className="section-heading">
              <h2 id="workflow-title">Del anuncio a la visita, sin perder el hilo.</h2>
              <p>Genera un enlace para tu inmueble. Comparte el enlace, y centraliza todos los datos de los interesados automáticamente</p>
            </div>
            <ol className="workflow-grid">
              {workflow.map(({ icon: Icon, title, text, image, fallback, alt }) => (
                <li key={title}>
                  <picture className="workflow-visual">
                    <source srcSet={image} type="image/webp" />
                    <img src={fallback} alt={alt} width="800" height="600" loading="lazy" decoding="async" />
                  </picture>
                  <div className="workflow-card-copy">
                    <span className="workflow-icon" aria-hidden="true"><Icon /></span>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="property-section section-space" id="funciones" aria-labelledby="property-title">
          <div className="page-shell property-layout">
            <div className="property-copy">
              <p className="section-kicker">Todo por inmueble</p>
              <h2 id="property-title">Una vista que responde antes de que tengas que buscar.</h2>
              <p>Consulta contacto, ingresos, documentos, estado y próxima visita en el mismo lugar. Así se ve cada anuncio dentro de Inquilink.</p>
              <a className="text-link" href="/registro">Organiza tu primer anuncio <ArrowRight aria-hidden="true" /></a>
            </div>
            <ListingPreview />
          </div>
        </section>

        <section className="documents-section section-space" aria-labelledby="documents-title">
          <div className="page-shell documents-layout">
            <div className="documents-visual">
              <picture>
                <source media="(max-width: 767px)" srcSet="/assets/inquilink-workflow-768.webp" type="image/webp" />
                <source srcSet="/assets/inquilink-workflow.webp" type="image/webp" />
                <img
                  src="/assets/inquilink-workflow.png"
                  alt="Flujo visual que conecta documentación, candidatos y seguimiento de un inmueble"
                  width="1536"
                  height="1024"
                  loading="lazy"
                />
              </picture>
            </div>
            <div className="documents-copy">
              <FileLock aria-hidden="true" className="feature-icon" />
              <h2 id="documents-title">La solvencia, asociada a la solicitud correcta.</h2>
              <p>Solicita nóminas, contratos y justificantes. Cada archivo queda privado, ordenado y disponible para la agencia responsable.</p>
              <div className="document-types" aria-label="Tipos de documento disponibles">
                <span><CheckCircle aria-hidden="true" /> Nóminas</span>
                <span><CheckCircle aria-hidden="true" /> Contrato laboral</span>
                <span><CheckCircle aria-hidden="true" /> Justificantes</span>
              </div>
            </div>
          </div>
        </section>

        <section className="followup-section section-space" aria-labelledby="followup-title">
          <div className="page-shell">
            <div className="section-heading compact-heading">
              <h2 id="followup-title">Haz avanzar cada candidatura.</h2>
              <p>Las acciones del día a día están a un clic, dentro del contexto del inmueble.</p>
            </div>
            <div className="followup-grid">
              <article className="followup-card followup-primary">
                <WhatsappLogo aria-hidden="true" />
                <h3>Contacta por WhatsApp</h3>
                <p>Abre un mensaje editable con el nombre de la agencia y la referencia del inmueble.</p>
              </article>
              <article className="followup-card">
                <CalendarCheck aria-hidden="true" />
                <h3>Agenda visitas</h3>
                <p>Crea, cambia o cancela una cita sin perder su historial.</p>
              </article>
              <article className="followup-card followup-tinted">
                <List aria-hidden="true" />
                <h3>Gestiona estados</h3>
                <p>Detecta quién necesita atención y qué paso viene después.</p>
              </article>
              <article className="followup-card">
                <NotePencil aria-hidden="true" />
                <h3>Añade notas</h3>
                <p>Comparte contexto privado con las personas de tu agencia.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="agency-section section-space" aria-labelledby="agency-title">
          <div className="page-shell agency-layout">
            <div>
              <h2 id="agency-title">Creado para inmobiliarias con demanda real.</h2>
              <p>Inquilink convierte un flujo disperso en una forma clara de trabajar, tanto si gestionas una agencia pequeña como un equipo en crecimiento.</p>
            </div>
            <div className="agency-benefits">
              <div><FolderOpen aria-hidden="true" /><strong>Un expediente por interés</strong><span>Sin mezclar inmuebles ni candidatos.</span></div>
              <div><UsersThree aria-hidden="true" /><strong>Responsabilidad visible</strong><span>Cada seguimiento tiene una persona asignada.</span></div>
            </div>
          </div>
        </section>

        <section className="pricing-section section-space" id="precios" aria-labelledby="pricing-title">
          <div className="page-shell">
            <div className="section-heading pricing-heading">
              <h2 id="pricing-title">Prueba el flujo completo durante 30 días.</h2>
            </div>
            <div className="pricing-grid">
              {pricingPlans.map((plan) => <PricingCard plan={plan} key={plan.id} />)}
            </div>
            <p className="pricing-contact">¿Tu empresa tiene necesidades más allá de estos planes? <a href="mailto:hola@inquilink.es">Contacta con nosotros</a>.</p>
            <p className="tax-note">Los precios mostrados incluyen IVA en este prototipo. La política fiscal definitiva se confirmará antes del lanzamiento.</p>
          </div>
        </section>

        <section className="security-section section-space" aria-labelledby="security-title">
          <div className="page-shell security-layout">
            <div className="security-title">
              <ShieldCheck aria-hidden="true" />
              <h2 id="security-title">Los datos sensibles merecen un acceso responsable.</h2>
            </div>
            <div className="security-points">
              <div><LockKey aria-hidden="true" /><p><strong>Acceso controlado</strong> Cada agencia accede únicamente a sus datos.</p></div>
              <div><FileLock aria-hidden="true" /><p><strong>Documentos privados</strong> Los archivos no se publican con enlaces permanentes.</p></div>
              <div><CheckCircle aria-hidden="true" /><p><strong>Decisiones humanas</strong> Inquilink no puntúa ni descarta candidatos automáticamente.</p></div>
            </div>
          </div>
        </section>

        <section className="faq-section section-space" id="preguntas" aria-labelledby="faq-title">
          <div className="page-shell faq-layout">
            <div className="faq-intro">
              <h2 id="faq-title">Preguntas frecuentes</h2>
              <p>Lo esencial para empezar con Inquilink.</p>
              <a className="text-link" href="mailto:hola@inquilink.es">¿Tienes otra pregunta? Escríbenos <ArrowRight aria-hidden="true" /></a>
            </div>
            <div className="faq-list">
              {faqItems.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}<span aria-hidden="true">+</span></summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta section-space" aria-labelledby="final-title">
          <div className="page-shell final-cta-inner">
            <div>
              <h2 id="final-title">Cientos de inquilinos. Un solo portal.</h2>
              <p>Empieza a organizar cada candidato desde su inmueble.</p>
            </div>
            <a className="button button-dark button-large" href="/registro">Pruébalo ahora <ArrowRight aria-hidden="true" /></a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="page-shell footer-grid">
          <div className="footer-brand"><Logo /><p>El Portal de Inquilinos para Inmobiliarias y Particulares.</p></div>
          <div><h2>Producto</h2><a href="#como-funciona">Cómo funciona</a><a href="#funciones">Funciones</a><a href="/precios">Precios</a></div>
          <div><h2>Acceso</h2><a href="/iniciar-sesion">Iniciar sesión</a><a href="/registro">Pruébalo ahora</a></div>
          <div><h2>Legal</h2><a href="/legal/privacidad">Privacidad</a><a href="/legal/terminos">Términos</a><a href="/legal/cookies">Cookies</a></div>
        </div>
        <div className="page-shell footer-bottom"><span>© 2026 Inquilink</span><span>Hecho para agencias inmobiliarias en España.</span></div>
      </footer>
    </div>
  )
}
