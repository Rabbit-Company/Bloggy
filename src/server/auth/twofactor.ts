import { generateTOTP, generateTOTPSecret, generateTOTPURI, verifyTOTP } from "@rabbit-company/totp";
import PasswordGenerator from "@rabbit-company/password-generator";
import { config } from "../config.ts";
import { BACKUP_CODE_COUNT } from "../lib/constants.ts";
import { decrypt, encrypt } from "../lib/crypto.ts";
import { updateTwoFactor, type CreatorRow } from "../db/creators.ts";

export interface TwoFactorEnrollment {
	secret: string;
	uri: string;
	backupCodes: string[];
}

export function beginTwoFactor(username: string): TwoFactorEnrollment {
	const secret = generateTOTPSecret();

	return {
		secret,
		uri: generateTOTPURI({ accountName: username, issuer: config.site.title, secret }),
		backupCodes: generateBackupCodes(),
	};
}

export async function confirmTwoFactor(username: string, secret: string, backupCodes: string[], code: string): Promise<boolean> {
	if (!(await verifyTOTP(code, secret, { window: 1 }))) return false;

	await updateTwoFactor(username, encrypt(secret), encrypt(JSON.stringify(backupCodes)));
	return true;
}

export async function disableTwoFactor(username: string): Promise<void> {
	await updateTwoFactor(username, null, null);
}

function generateBackupCodes(): string[] {
	const codes: string[] = [];
	for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
		const raw = PasswordGenerator.generate(8, true, true, false).toUpperCase();
		codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
	}
	return codes;
}

export function isTwoFactorEnabled(creator: CreatorRow): boolean {
	return creator.totp_secret !== null;
}

export async function verifyOtp(creator: CreatorRow, otp: string): Promise<boolean> {
	if (!isTwoFactorEnabled(creator)) return true;

	const secret = creator.totp_secret === null ? null : decrypt(creator.totp_secret);
	// A secret that will not decrypt means the encryption key changed. Failing
	// closed is the only safe option: it must not silently skip the check.
	if (secret === null) return false;

	// window: 1 accepts the adjacent 30-second steps, covering clock drift.
	if (await verifyTOTP(otp, secret, { window: 1 })) return true;

	return await consumeBackupCode(creator, otp);
}

async function consumeBackupCode(creator: CreatorRow, otp: string): Promise<boolean> {
	if (creator.backup_codes === null) return false;

	const decrypted = decrypt(creator.backup_codes);
	if (decrypted === null) return false;

	let codes: string[];
	try {
		codes = JSON.parse(decrypted) as string[];
		if (!Array.isArray(codes)) return false;
	} catch {
		return false;
	}

	const normalized = otp.trim().toUpperCase();
	const index = codes.indexOf(normalized);
	if (index === -1) return false;

	codes.splice(index, 1);
	await updateTwoFactor(creator.username, creator.totp_secret, encrypt(JSON.stringify(codes)));
	return true;
}

export function remainingBackupCodes(creator: CreatorRow): number {
	if (creator.backup_codes === null) return 0;
	const decrypted = decrypt(creator.backup_codes);
	if (decrypted === null) return 0;
	try {
		const codes = JSON.parse(decrypted) as string[];
		return Array.isArray(codes) ? codes.length : 0;
	} catch {
		return 0;
	}
}

export async function regenerateBackupCodes(creator: CreatorRow): Promise<string[]> {
	const codes = generateBackupCodes();
	await updateTwoFactor(creator.username, creator.totp_secret, encrypt(JSON.stringify(codes)));
	return codes;
}

export { generateTOTP };
