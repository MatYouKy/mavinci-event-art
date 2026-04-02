import { X509Certificate, publicEncrypt, constants } from "node:crypto";
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