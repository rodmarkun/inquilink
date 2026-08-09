import { z } from "zod";
import { emailTemplateNames, validateEmailMessage, type EmailMessage, type EmailTemplateName } from "./provider.js";

export interface RenderedEmail {
  subject: string;
  preview: string;
  text: string;
}

const formatDateTime = (value: string): string => new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Madrid",
}).format(new Date(value));

const formatDate = (value: string): string => new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeZone: "Europe/Madrid",
}).format(new Date(value));

const planNames = {
  particular: "Particular",
  professional: "Profesional",
  inmobiliaria: "Inmobiliaria",
} as const;

function safeAppLink(appOrigin: string, path: string): string {
  const origin = z.url().parse(appOrigin);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("INVALID_EMAIL_PATH");
  return new URL(path, origin).toString();
}

const subjects: Record<EmailTemplateName, { subject: string; preview: string }> = {
  new_applicant: { subject: "Tienes una nueva solicitud en Inquilink", preview: "Hay una nueva solicitud disponible en tu espacio de agencia." },
  viewing_reminder: { subject: "Recordatorio de una próxima visita", preview: "Consulta los detalles de la visita en Inquilink." },
  trial_ending: { subject: "Tu prueba de Inquilink termina pronto", preview: "Revisa la fecha de finalización y los datos de tu plan." },
  payment_failure: { subject: "No hemos podido procesar tu pago", preview: "Actualiza el método de pago desde tu área de facturación." },
  team_invitation: { subject: "Te han invitado a un equipo de Inquilink", preview: "Acepta la invitación para colaborar con tu agencia." },
  verify_email: { subject: "Verifica tu cuenta de Inquilink", preview: "Confirma tu correo para continuar en Inquilink." },
  reset_password: { subject: "Restablece tu contraseña de Inquilink", preview: "Usa este enlace seguro para crear una nueva contraseña." },
  application_received: { subject: "Hemos recibido tu solicitud", preview: "Tu solicitud ya está disponible en tu cuenta de Inquilink." },
  viewing_created: { subject: "Tu visita ha sido agendada", preview: "Consulta la fecha y la hora de tu próxima visita." },
  viewing_rescheduled: { subject: "Tu visita ha cambiado", preview: "Consulta la nueva fecha y hora de tu visita." },
  viewing_cancelled: { subject: "Tu visita ha sido cancelada", preview: "La agencia ha cancelado esta visita." },
};

export function renderEmail(rawMessage: EmailMessage, appOrigin: string): RenderedEmail {
  const message = validateEmailMessage(rawMessage);
  const heading = subjects[message.template];
  const variables = message.variables;
  let text: string;
  switch (message.template) {
    case "new_applicant":
      text = `Has recibido una nueva solicitud para ${variables.propertyTitle}. Ábrela desde tu espacio de Inquilink.`;
      break;
    case "viewing_reminder":
      text = `Tienes una visita prevista para ${formatDateTime(variables.startsAt!)}. Consulta los detalles antes de la cita.`;
      break;
    case "trial_ending":
      text = `Tu prueba del plan ${planNames[variables.plan! as keyof typeof planNames]} termina el ${formatDate(variables.trialEndsAt!)}. Revisa tu plan en Facturación.`;
      break;
    case "payment_failure":
      text = `No hemos podido procesar el pago. Revisa el método de pago en ${safeAppLink(appOrigin, variables.billingPath!)}.`;
      break;
    case "team_invitation":
      text = `${variables.agencyName} te ha invitado a colaborar en Inquilink. Acepta la invitación desde ${safeAppLink(appOrigin, `/aceptar-invitacion?token=${encodeURIComponent(variables.token!)}`)}.`;
      break;
    case "verify_email":
      text = `Confirma tu correo desde ${safeAppLink(appOrigin, `/verificar-correo?token=${encodeURIComponent(variables.token!)}&volver=${encodeURIComponent(variables.returnPath!)}`)}.`;
      break;
    case "reset_password":
      text = `Crea una nueva contraseña desde ${safeAppLink(appOrigin, `/restablecer-contrasena?token=${encodeURIComponent(variables.token!)}&volver=${encodeURIComponent(variables.returnPath!)}`)}.`;
      break;
    case "application_received":
      text = `${variables.agencyName} ha recibido tu solicitud para ${variables.propertyTitle}. Puedes consultar su estado desde tu cuenta.`;
      break;
    case "viewing_created":
      text = `Tu visita se ha agendado para ${formatDateTime(variables.startsAt!)}.`;
      break;
    case "viewing_rescheduled":
      text = `Tu visita se ha reprogramado para ${formatDateTime(variables.startsAt!)}.`;
      break;
    case "viewing_cancelled":
      text = `La visita prevista para ${formatDateTime(variables.startsAt!)} ha sido cancelada.`;
      break;
    default: {
      const exhaustive: never = message.template;
      throw new Error(`UNKNOWN_EMAIL_TEMPLATE:${exhaustive}`);
    }
  }
  return { ...heading, text };
}

export function isEmailTemplateName(value: string): value is EmailTemplateName {
  return (emailTemplateNames as readonly string[]).includes(value);
}
