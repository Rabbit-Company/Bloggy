import Blake2b from "@rabbit-company/blake2b";
import XChaCha20 from "@rabbit-company/xchacha20";
import PasswordGenerator from "@rabbit-company/password-generator";
import PasswordEntropy from "@rabbit-company/password-entropy";
import { config } from "../config.ts";

export function hash(value: string): string {
	return Blake2b.hash(value);
}

/**
 * Both sides are hashed first so the comparison always runs over equal-length
 * buffers, which keeps the timing independent of where the inputs diverge.
 */
export function safeEqual(a: string, b: string): boolean {
	const ha = Buffer.from(Blake2b.hash(a), "hex");
	const hb = Buffer.from(Blake2b.hash(b), "hex");
	return crypto.timingSafeEqual(ha, hb);
}

export function generateToken(length = 64): string {
	return PasswordGenerator.generate(length, true, true, false);
}

export function passwordEntropy(password: string): number {
	return PasswordEntropy.calculate(password);
}

export function hashPassword(password: string): Promise<string> {
	return Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	try {
		return await Bun.password.verify(password, stored);
	} catch {
		return false;
	}
}

/**
 * XChaCha20.decrypt returns garbage rather than throwing when given the wrong
 * key, so the plaintext is wrapped in a JSON envelope carrying this marker.
 * Decryption is only accepted when the envelope parses and the marker matches,
 * which turns a wrong or rotated ENCRYPTION_KEY into a clean failure.
 */
const ENVELOPE_MARKER = "bloggy.v1";

interface Envelope {
	m: typeof ENVELOPE_MARKER;
	v: string;
}

export function encrypt(plaintext: string): string {
	const envelope: Envelope = { m: ENVELOPE_MARKER, v: plaintext };
	return XChaCha20.encrypt(JSON.stringify(envelope), config.secrets.encryptionKey);
}

export function decrypt(ciphertext: string): string | null {
	try {
		const envelope = JSON.parse(XChaCha20.decrypt(ciphertext, config.secrets.encryptionKey)) as Envelope;
		if (envelope?.m !== ENVELOPE_MARKER || typeof envelope.v !== "string") return null;
		return envelope.v;
	} catch {
		return null;
	}
}

export function uuid(): string {
	return crypto.randomUUID();
}
