import {
  X509Certificate,
  publicEncrypt,
  constants,
  randomBytes,
  createCipheriv,
  createHash,
} from "node:crypto";
import { KSEF_LOG_PREFIX } from "./logger";

function derBase64ToPemCertificate(base64Der: string): string {
  const lines = base64Der.match(/.{1,64}/g)?.join("\n") ?? base64Der;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}

export function encryptKSeFTokenPayloadFromCertificate(
  plainText: string,
  certificateBase64Der: string
): string {
  console.log(`${KSEF_LOG_PREFIX} crypto import certificate`, {
    plainTextLength: plainText.length,
    hasCertificate: !!certificateBase64Der,
  });

  const certPem = derBase64ToPemCertificate(certificateBase64Der);
  const x509 = new X509Certificate(certPem);
  const publicKey = x509.publicKey;

  const encrypted = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(plainText, "utf8")
  );

  const base64 = encrypted.toString("base64");

  console.log(`${KSEF_LOG_PREFIX} crypto encrypted payload`, {
    plainTextLength: plainText.length,
    encryptedLength: base64.length,
  });

  return base64;
}

export interface SymmetricKeyMaterial {
  symmetricKey: Buffer;
  initializationVector: Buffer;
  encryptedSymmetricKey: string;
  initializationVectorBase64: string;
}

export function createSymmetricKeyMaterial(
  certificateBase64Der: string
): SymmetricKeyMaterial {
  const symmetricKey = randomBytes(32);
  const initializationVector = randomBytes(16);

  const certPem = derBase64ToPemCertificate(certificateBase64Der);
  const x509 = new X509Certificate(certPem);
  const publicKey = x509.publicKey;

  const encryptedSymmetricKey = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    symmetricKey
  ).toString("base64");

  return {
    symmetricKey,
    initializationVector,
    encryptedSymmetricKey,
    initializationVectorBase64: initializationVector.toString("base64"),
  };
}

export interface EncryptedInvoicePayload {
  invoiceHash: string;
  invoiceSize: number;
  encryptedInvoiceHash: string;
  encryptedInvoiceSize: number;
  encryptedInvoiceContent: string;
  hashOfCorrectedInvoice: string | null;
  offlineMode?: boolean;
}

function sha256Base64(data: Buffer): string {
  return createHash("sha256").update(data).digest("base64");
}

export function encryptInvoiceXml(
  invoiceXml: string,
  material: SymmetricKeyMaterial
): EncryptedInvoicePayload {
  const invoiceBuffer = Buffer.from(invoiceXml, "utf8");

  const cipher = createCipheriv(
    "aes-256-cbc",
    material.symmetricKey,
    material.initializationVector
  );
  const encryptedBuffer = Buffer.concat([
    cipher.update(invoiceBuffer),
    cipher.final(),
  ]);

  return {
    invoiceHash: sha256Base64(invoiceBuffer),
    invoiceSize: invoiceBuffer.byteLength,
    encryptedInvoiceHash: sha256Base64(encryptedBuffer),
    encryptedInvoiceSize: encryptedBuffer.byteLength,
    encryptedInvoiceContent: encryptedBuffer.toString("base64"),
    hashOfCorrectedInvoice: null,
    offlineMode: false,
  };
}