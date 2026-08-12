import { HomePage } from './pages/HomePage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { useEffect } from 'react'
import { PublicApplicationPage } from './pages/PublicApplicationPage'
import { AuthBillingPage } from './pages/AuthBillingPage'
import { AgencyWorkspacePage } from './pages/AgencyWorkspacePage'

const homeStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', name: 'Inquilink', url: 'https://inquilink.es/' },
    {
      '@type': 'SoftwareApplication',
      name: 'Inquilink',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      offers: [
        { '@type': 'Offer', price: '9.99', priceCurrency: 'EUR', name: 'Particular' },
        { '@type': 'Offer', price: '49.99', priceCurrency: 'EUR', name: 'Profesional' },
        { '@type': 'Offer', price: '99.99', priceCurrency: 'EUR', name: 'Inmobiliaria' },
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        { '@type': 'Question', name: '¿Los inquilinos necesitan una cuenta?', acceptedAnswer: { '@type': 'Answer', text: 'Sí. Cada interesado crea una cuenta o inicia sesión antes de completar la solicitud para guardar su progreso y consultar sus candidaturas con seguridad.' } },
        { '@type': 'Question', name: '¿Puedo cancelar durante la prueba?', acceptedAnswer: { '@type': 'Answer', text: 'Sí. Puedes cancelar en cualquier momento desde Facturación. Verás la fecha exacta del primer cargo antes de confirmar el plan.' } },
        { '@type': 'Question', name: '¿Cómo funciona el enlace de cada inmueble?', acceptedAnswer: { '@type': 'Answer', text: 'Al publicar un anuncio, Inquilink genera un enlace único. Puedes copiarlo en un clic y añadirlo a cualquier portal inmobiliario o compartirlo por WhatsApp.' } },
        { '@type': 'Question', name: '¿Qué documentación pueden enviar?', acceptedAnswer: { '@type': 'Answer', text: 'Puedes solicitar nóminas, contratos laborales, justificantes para autónomos y otros documentos de solvencia en PDF, JPG o PNG.' } },
        { '@type': 'Question', name: '¿Puedo trabajar con mi equipo?', acceptedAnswer: { '@type': 'Answer', text: 'Sí. Profesional permite hasta 3 cuentas e Inmobiliaria incluye cuentas ilimitadas. Particular está limitado a una cuenta de administrador.' } },
      ],
    },
  ],
}

const publicPlaceholders: Record<string, { title: string; body: string }> = {
  '/precios': {
    title: 'Planes para cada inmobiliaria',
    body: 'Elige Particular, Profesional o Inmobiliaria según el tamaño de tu cartera y tu equipo.',
  },
  '/iniciar-sesion': {
    title: 'Iniciar sesión',
    body: 'Accede al portal de tu inmobiliaria.',
  },
  '/registro': {
    title: 'Prueba Inquilink gratis',
    body: 'Crea tu espacio y empieza tus 30 días de prueba.',
  },
  '/aceptar-invitacion': {
    title: 'Aceptar invitación',
    body: 'Únete al espacio de trabajo que te ha invitado.',
  },
  '/recuperar-contrasena': {
    title: 'Recuperar contraseña',
    body: 'Solicita un enlace seguro para volver a acceder a tu cuenta.',
  },
  '/restablecer-contrasena': {
    title: 'Restablecer contraseña',
    body: 'Crea una contraseña nueva para tu cuenta de Inquilink.',
  },
  '/verificar-correo': {
    title: 'Verificar correo',
    body: 'Confirma tu correo para activar el acceso a Inquilink.',
  },
  '/mis-solicitudes': {
    title: 'Mis solicitudes',
    body: 'Consulta el estado de tus solicitudes de alquiler.',
  },
  '/legal/privacidad': {
    title: 'Política de privacidad',
    body: 'La versión legal completa estará disponible antes del lanzamiento.',
  },
  '/legal/terminos': {
    title: 'Términos de servicio',
    body: 'La versión legal completa estará disponible antes del lanzamiento.',
  },
  '/legal/cookies': {
    title: 'Política de cookies',
    body: 'La versión legal completa estará disponible antes del lanzamiento.',
  },
}

export function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  const isAgencyRoute = path === '/app' || path.startsWith('/app/')
  const isAuthBillingRoute = ['/precios', '/registro', '/iniciar-sesion', '/aceptar-invitacion', '/recuperar-contrasena', '/restablecer-contrasena', '/verificar-correo', '/mis-solicitudes', '/facturacion/demo'].includes(path)

  useEffect(() => {
    const routeTitle = isAgencyRoute
      ? 'Panel de agencia'
      : path === '/facturacion/demo'
        ? 'Facturación'
        : publicPlaceholders[path]?.title
    const fullTitle = path === '/'
      ? 'Inquilink | El Portal de Inquilinos para Inmobiliarias y Particulares'
      : path.startsWith('/solicitud/')
        ? 'Solicitud de alquiler | Inquilink'
        : `${routeTitle ?? 'Página no encontrada'} | Inquilink`
    const description = path === '/'
      ? 'Inquilink centraliza los interesados, la documentación de solvencia y las visitas de cada inmueble para agencias inmobiliarias.'
      : path === '/precios'
        ? 'Compara los planes Particular, Profesional e Inmobiliaria de Inquilink y prueba todas las funciones durante 30 días.'
        : publicPlaceholders[path]?.body ?? 'Gestiona tu cuenta de Inquilink de forma segura.'
    document.title = fullTitle

    const descriptionMeta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
      ?? Object.assign(document.head.appendChild(document.createElement('meta')), { name: 'description' })
    descriptionMeta.content = description

    const setOpenGraph = (property: string, content: string) => {
      const meta = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)
        ?? Object.assign(document.head.appendChild(document.createElement('meta')), { property })
      meta.content = content
    }
    setOpenGraph('og:title', fullTitle)
    setOpenGraph('og:description', description)
    setOpenGraph('og:url', new URL(path, 'https://inquilink.es').href)

    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
      ?? Object.assign(document.head.appendChild(document.createElement('meta')), { name: 'robots' })
    robots.content = path.startsWith('/solicitud/') || isAgencyRoute || path === '/facturacion/demo' || ['/aceptar-invitacion', '/recuperar-contrasena', '/restablecer-contrasena', '/verificar-correo', '/mis-solicitudes'].includes(path)
      ? 'noindex, nofollow'
      : 'index, follow'

    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (canonical) canonical.href = new URL(path, 'https://inquilink.es').href

    const existingStructuredData = document.querySelector<HTMLScriptElement>('#inquilink-home-structured-data')
    if (path === '/') {
      const structuredData = existingStructuredData ?? Object.assign(document.head.appendChild(document.createElement('script')), {
        id: 'inquilink-home-structured-data',
        type: 'application/ld+json',
      })
      structuredData.textContent = JSON.stringify(homeStructuredData)
    } else {
      existingStructuredData?.remove()
    }
  }, [isAgencyRoute, path])

  if (path === '/') return <HomePage />

  if (path.startsWith('/solicitud/')) return <PublicApplicationPage />

  if (isAgencyRoute) return <AgencyWorkspacePage />

  if (isAuthBillingRoute) return <AuthBillingPage />

  const page = publicPlaceholders[path]
  return page ? <PlaceholderPage {...page} /> : <PlaceholderPage title="Página no encontrada" body="Esta página no existe." />
}
