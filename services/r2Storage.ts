import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
  endpoint: string;
}

function sanitizeVal(val: string | undefined): string {
  if (!val) return "";
  let clean = val.trim();
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1).trim();
  }
  return clean;
}

function cleanAccountId(val: string | undefined): string {
  let clean = sanitizeVal(val);
  if (clean.includes("r2.cloudflarestorage.com")) {
    clean = clean.replace(/^https?:\/\//i, "").replace(/\.r2\.cloudflarestorage\.com.*$/i, "");
  } else if (clean.startsWith("http://") || clean.startsWith("https://")) {
    clean = clean.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
  return clean;
}

export function maskSecret(val: string, visibleChars = 4): string {
  if (!val) return "[MISSING]";
  if (val.length <= visibleChars * 2) {
    return `${val.substring(0, 2)}*** (len: ${val.length})`;
  }
  return `${val.substring(0, visibleChars)}...${val.substring(val.length - visibleChars)} (len: ${val.length})`;
}

export function getR2Config(): R2Config {
  const rawAccountId =
    process.env.CLOUDFLARE_R2_ACCOUNT_ID ||
    process.env.R2_ACCOUNT_ID ||
    process.env.VITE_R2_ACCOUNT_ID ||
    process.env.VITE_CLOUDFLARE_R2_ACCOUNT_ID ||
    "";

  const rawAccessKeyId =
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ||
    process.env.R2_ACCESS_KEY_ID ||
    process.env.R2_ACCESS_KEY ||
    process.env.VITE_R2_ACCESS_KEY_ID ||
    "";

  const rawSecretAccessKey =
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.R2_SECRET_KEY ||
    process.env.VITE_R2_SECRET_ACCESS_KEY ||
    "";

  const rawBucketName =
    process.env.CLOUDFLARE_R2_BUCKET_NAME ||
    process.env.R2_BUCKET_NAME ||
    process.env.R2_BUCKET ||
    process.env.VITE_R2_BUCKET_NAME ||
    "";

  const rawPublicUrl =
    process.env.CLOUDFLARE_R2_PUBLIC_URL ||
    process.env.R2_PUBLIC_URL ||
    process.env.R2_CUSTOM_DOMAIN ||
    process.env.VITE_R2_PUBLIC_URL ||
    "";

  const accountId = cleanAccountId(rawAccountId);
  const accessKeyId = sanitizeVal(rawAccessKeyId);
  const secretAccessKey = sanitizeVal(rawSecretAccessKey);
  const bucketName = sanitizeVal(rawBucketName);
  const publicUrl = sanitizeVal(rawPublicUrl).replace(/\/$/, "");

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
    endpoint: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "",
  };
}

export function getR2DiagnosticSummary() {
  const config = getR2Config();
  const rawAccount = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || "";
  const rawAccess = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || "";
  const rawSecret = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || "";
  const rawBucket = process.env.CLOUDFLARE_R2_BUCKET_NAME || process.env.R2_BUCKET_NAME || "";

  const warnings: string[] = [];

  if (rawAccount.includes("http") || rawAccount.includes("r2.cloudflarestorage.com")) {
    warnings.push("R2_ACCOUNT_ID contained an HTTP or domain prefix/suffix, which was automatically sanitized.");
  }
  if ([rawAccount, rawAccess, rawSecret, rawBucket].some((v) => v.startsWith('"') || v.startsWith("'"))) {
    warnings.push("One or more R2 environment variables contained surrounding quotes, which were automatically stripped.");
  }
  if ([rawAccount, rawAccess, rawSecret, rawBucket].some((v) => v !== v.trim())) {
    warnings.push("One or more R2 environment variables contained leading or trailing spaces, which were automatically trimmed.");
  }

  const isConfigured = Boolean(config.accountId && config.accessKeyId && config.secretAccessKey && config.bucketName);

  return {
    isConfigured,
    maskedConfig: {
      accountId: maskSecret(config.accountId, 4),
      accessKeyId: maskSecret(config.accessKeyId, 4),
      secretAccessKey: maskSecret(config.secretAccessKey, 4),
      bucketName: config.bucketName || "[MISSING]",
      publicUrl: config.publicUrl || "[NOT SET - using R2 default domain]",
      endpoint: config.endpoint || "[NOT SET - Account ID missing]",
    },
    missingVars: [
      !config.accountId && "R2_ACCOUNT_ID / CLOUDFLARE_R2_ACCOUNT_ID",
      !config.accessKeyId && "R2_ACCESS_KEY_ID / CLOUDFLARE_R2_ACCESS_KEY_ID",
      !config.secretAccessKey && "R2_SECRET_ACCESS_KEY / CLOUDFLARE_R2_SECRET_ACCESS_KEY",
      !config.bucketName && "R2_BUCKET_NAME / CLOUDFLARE_R2_BUCKET_NAME",
    ].filter(Boolean) as string[],
    warnings,
  };
}

export interface ParsedR2Error {
  category: "MISSING_CONFIG" | "AUTH_FAILED" | "BUCKET_NOT_FOUND" | "NETWORK_ENDPOINT_ERROR" | "R2_STORAGE_ERROR";
  statusCode: number;
  errorName: string;
  message: string;
  s3Code?: string;
  requestId?: string;
  cfRay?: string;
  troubleshooting: string;
  diagnosticSummary: ReturnType<typeof getR2DiagnosticSummary>;
}

export function parseR2Error(error: any): ParsedR2Error {
  const diag = getR2DiagnosticSummary();
  const name = error?.name || error?.code || "UnknownError";
  const message = error?.message || String(error);
  const metadata = error?.$metadata || {};
  const httpStatusCode = metadata.httpStatusCode || error?.statusCode || error?.status || 500;
  const requestId = metadata.requestId || error?.requestId;
  const cfRay = error?.$response?.headers?.["cf-ray"] || error?.cfRay;
  const s3Code = error?.Code || error?.code || name;

  if (!diag.isConfigured) {
    return {
      category: "MISSING_CONFIG",
      statusCode: 400,
      errorName: "MissingConfiguration",
      message: `Faltan variables de entorno para Cloudflare R2: ${diag.missingVars.join(", ")}`,
      troubleshooting:
        "Configura R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET_NAME en Vercel -> Settings -> Environment Variables.",
      diagnosticSummary: diag,
    };
  }

  const isAuthError =
    httpStatusCode === 401 ||
    httpStatusCode === 403 ||
    s3Code === "InvalidAccessKeyId" ||
    s3Code === "SignatureDoesNotMatch" ||
    s3Code === "AccessDenied" ||
    s3Code === "InvalidToken" ||
    message.includes("SignatureDoesNotMatch") ||
    message.includes("InvalidAccessKeyId") ||
    message.includes("Access Denied");

  if (isAuthError) {
    let specificCause = "Las credenciales de autenticación de Cloudflare R2 son rechazada por la API de Cloudflare.";
    if (s3Code === "InvalidAccessKeyId" || message.includes("InvalidAccessKeyId")) {
      specificCause = "El 'R2_ACCESS_KEY_ID' proporcionado es incorrecto o no existe en tu cuenta de Cloudflare.";
    } else if (s3Code === "SignatureDoesNotMatch" || message.includes("SignatureDoesNotMatch")) {
      specificCause = "El 'R2_SECRET_ACCESS_KEY' proporcionado no coincide con el Access Key ID o fue copiado de forma errónea.";
    } else if (s3Code === "AccessDenied" || message.includes("Access Denied")) {
      specificCause = "El API Token de R2 no tiene permisos de edición u objetos (Admin Read & Write) para el bucket especificado.";
    }

    return {
      category: "AUTH_FAILED",
      statusCode: 403,
      errorName: s3Code || "R2AuthFailure",
      message: `Error de autenticación con Cloudflare R2: ${message}`,
      s3Code,
      requestId,
      cfRay,
      troubleshooting: `${specificCause} Verifica tus claves en Cloudflare Dashboard > R2 > Manage R2 API Tokens, y asegúrate de asignarle 'Object Read & Write' permissions.`,
      diagnosticSummary: diag,
    };
  }

  if (httpStatusCode === 404 || s3Code === "NoSuchBucket" || message.includes("NoSuchBucket")) {
    return {
      category: "BUCKET_NOT_FOUND",
      statusCode: 404,
      errorName: "NoSuchBucket",
      message: `El bucket de R2 no fue encontrado: ${message}`,
      s3Code,
      requestId,
      cfRay,
      troubleshooting: "Revisa que el nombre en R2_BUCKET_NAME coincida exactamente con el nombre de tu bucket en Cloudflare R2.",
      diagnosticSummary: diag,
    };
  }

  if (name === "ENOTFOUND" || name === "ECONNREFUSED" || message.includes("getaddrinfo") || message.includes("ENOTFOUND")) {
    return {
      category: "NETWORK_ENDPOINT_ERROR",
      statusCode: 502,
      errorName: name,
      message: `No se pudo resolver el endpoint de Cloudflare R2 (${diag.maskedConfig.endpoint}).`,
      s3Code,
      requestId,
      troubleshooting: "Asegúrate de que R2_ACCOUNT_ID sea solo el hash de 32 caracteres hexadecimales de tu cuenta de Cloudflare.",
      diagnosticSummary: diag,
    };
  }

  return {
    category: "R2_STORAGE_ERROR",
    statusCode: httpStatusCode >= 400 && httpStatusCode < 600 ? httpStatusCode : 500,
    errorName: name,
    message: `Error al procesar la solicitud en Cloudflare R2: ${message}`,
    s3Code,
    requestId,
    cfRay,
    troubleshooting: "Revisa los detalles técnicos en los logs del servidor para identificar el error devuelto por AWS S3 Client / R2.",
    diagnosticSummary: diag,
  };
}

export function createR2Client() {
  const config = getR2Config();
  const diag = getR2DiagnosticSummary();

  if (!diag.isConfigured) {
    const errorMsg = `Cloudflare R2 is missing required environment variables: ${diag.missingVars.join(", ")}.`;
    console.error("[R2 Config Error]:", {
      missingVars: diag.missingVars,
      maskedConfig: diag.maskedConfig,
    });
    throw new Error(errorMsg);
  }

  if (diag.warnings.length > 0) {
    console.warn("[R2 Config Warnings]:", diag.warnings);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return { client, config };
}

export async function getPresignedR2Url(
  originalFilename: string,
  mimeType: string,
  folder: string = "uploads"
): Promise<{ presignedUrl: string; fileUrl: string; key: string; bucket: string }> {
  try {
    const { client, config } = createR2Client();

    const cleanName = originalFilename.replace(/[^a-zA-Z0-9.-]/g, "_");
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const key = `${folder}/${timestamp}-${randomStr}-${cleanName}`;

    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(client, command, { expiresIn: 3600 });

    let fileUrl = "";
    if (config.publicUrl) {
      fileUrl = `${config.publicUrl}/${key}`;
    } else {
      fileUrl = `https://${config.bucketName}.${config.accountId}.r2.cloudflarestorage.com/${key}`;
    }

    return {
      presignedUrl,
      fileUrl,
      key,
      bucket: config.bucketName,
    };
  } catch (error: any) {
    const parsed = parseR2Error(error);
    console.error("[R2 Presign Storage Error]:", {
      category: parsed.category,
      errorName: parsed.errorName,
      statusCode: parsed.statusCode,
      message: parsed.message,
      s3Code: parsed.s3Code,
      requestId: parsed.requestId,
      cfRay: parsed.cfRay,
      maskedConfig: parsed.diagnosticSummary.maskedConfig,
      warnings: parsed.diagnosticSummary.warnings,
      troubleshooting: parsed.troubleshooting,
    });
    throw error;
  }
}

export async function uploadToR2(
  fileBuffer: Buffer,
  originalFilename: string,
  mimeType: string,
  folder: string = "uploads"
): Promise<{ url: string; key: string; bucket: string }> {
  try {
    const { client, config } = createR2Client();

    const cleanName = originalFilename.replace(/[^a-zA-Z0-9.-]/g, "_");
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const key = `${folder}/${timestamp}-${randomStr}-${cleanName}`;

    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType || "application/octet-stream",
    });

    await client.send(command);

    let fileUrl = "";
    if (config.publicUrl) {
      fileUrl = `${config.publicUrl}/${key}`;
    } else {
      fileUrl = `https://${config.bucketName}.${config.accountId}.r2.cloudflarestorage.com/${key}`;
    }

    return {
      url: fileUrl,
      key,
      bucket: config.bucketName,
    };
  } catch (error: any) {
    const parsed = parseR2Error(error);
    console.error("[R2 Direct Upload Storage Error]:", {
      category: parsed.category,
      errorName: parsed.errorName,
      statusCode: parsed.statusCode,
      message: parsed.message,
      s3Code: parsed.s3Code,
      requestId: parsed.requestId,
      cfRay: parsed.cfRay,
      maskedConfig: parsed.diagnosticSummary.maskedConfig,
      warnings: parsed.diagnosticSummary.warnings,
      troubleshooting: parsed.troubleshooting,
    });
    throw error;
  }
}
