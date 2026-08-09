import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

type SpanishFieldError = { field: string; code: string; message: string };

function spanishZodIssues(error: ZodError): SpanishFieldError[] {
  return error.issues.map((issue) => {
    const field = issue.path.length ? issue.path.map(String).join(".") : "request";
    const code = issue.code.toUpperCase();
    const message = field === "termsAccepted" ? "Debes aceptar los términos de la cuenta para continuar."
      : field === "termsVersion" ? "La versión de los términos no es válida. Actualiza la página e inténtalo de nuevo."
      : issue.code === "invalid_type" ? "El tipo de dato no es válido."
      : issue.code === "too_small" ? "El valor no alcanza el mínimo permitido."
      : issue.code === "too_big" ? "El valor supera el máximo permitido."
      : issue.code === "invalid_format" ? "El formato no es válido."
      : issue.code === "invalid_value" ? "Selecciona una opción válida."
      : issue.code === "unrecognized_keys" ? "Hay campos que no están permitidos."
      : "El valor no es válido.";
    return { field, code, message };
  });
}

function spanishFastifyValidation(validation: unknown): SpanishFieldError[] | null {
  if (!Array.isArray(validation)) return null;
  return validation.map((item: unknown) => {
    const entry = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    const params = typeof entry.params === "object" && entry.params !== null ? entry.params as Record<string, unknown> : {};
    const rawPath = typeof entry.instancePath === "string" ? entry.instancePath.replace(/^\//, "").replaceAll("/", ".") : "";
    const field = typeof params.missingProperty === "string" ? params.missingProperty : rawPath || "request";
    const keyword = typeof entry.keyword === "string" ? entry.keyword : "validation";
    const message = keyword === "required" ? "Este campo es obligatorio."
      : keyword === "type" ? "El tipo de dato no es válido."
      : keyword === "format" ? "El formato no es válido."
      : keyword === "minLength" || keyword === "minimum" ? "El valor no alcanza el mínimo permitido."
      : keyword === "maxLength" || keyword === "maximum" ? "El valor supera el máximo permitido."
      : "El valor no es válido.";
    return { field, code: keyword.toUpperCase(), message };
  });
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function errorChain(error: unknown): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [];
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    const record = current as Record<string, unknown>;
    chain.push(record);
    current = record.cause;
  }
  return chain;
}

function stableDatabaseError(error: unknown): ApiError | null {
  const chain = errorChain(error);
  if (chain.some((entry) => typeof entry.message === "string" && entry.message.includes("APPLICATION_RETENTION_IN_PROGRESS"))) {
    return new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
  }
  return null;
}

function safeErrorFields(error: unknown): { errorClass: "database" | "unexpected"; errorCode: string } {
  const chain = errorChain(error);
  const database = chain.some((entry) => typeof entry.code === "string" && /^[0-9A-Z_]{2,20}$/.test(entry.code));
  const rawCode = chain.map((entry) => entry.code).find((code) => typeof code === "string" && /^[0-9A-Z_]{2,20}$/.test(code));
  return { errorClass: database ? "database" : "unexpected", errorCode: typeof rawCode === "string" ? rawCode : "UNHANDLED" };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details ?? null },
        requestId: request.id,
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Revisa los datos introducidos.", details: spanishZodIssues(error) },
        requestId: request.id,
      });
    }
    const databaseError = stableDatabaseError(error);
    if (databaseError) {
      return reply.status(databaseError.statusCode).send({
        error: { code: databaseError.code, message: databaseError.message, details: null },
        requestId: request.id,
      });
    }
    if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      const fastifyError = error as { statusCode: number; code?: string; validation?: unknown };
      const bodyTooLarge = fastifyError.statusCode === 413 || fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE";
      return reply.status(fastifyError.statusCode).send({
        error: {
          code: bodyTooLarge ? "PAYLOAD_TOO_LARGE" : "REQUEST_ERROR",
          message: bodyTooLarge ? "El contenido enviado supera el tamaño permitido." : "No se ha podido procesar la solicitud.",
          details: spanishFastifyValidation(fastifyError.validation),
        },
        requestId: request.id,
      });
    }
    // Drizzle/Postgres errors can embed SQL parameters (including applicant PII)
    // in messages and causes. Only stable, non-user-controlled fields are logged.
    request.log.error(safeErrorFields(error), "Unhandled API error");
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Ha ocurrido un error inesperado.", details: null },
      requestId: request.id,
    });
  });
}
