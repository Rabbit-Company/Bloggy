/**
 * Recovers an image's type from its first bytes.
 *
 * Media keys carry no file extension, so a driver that infers the type from the
 * name reports `application/octet-stream`. That value is truthy, so recording it
 * would defeat the fallbacks downstream and leave browsers downloading images
 * instead of rendering them. Sniffing is only reached when the driver has no
 * real answer, which on S3 means never.
 */
const UNUSABLE = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export function isUsableImageType(contentType: string | undefined): boolean {
	return contentType !== undefined && !UNUSABLE.has(contentType.toLowerCase().split(";")[0]?.trim() ?? "");
}

export function detectImageType(head: Uint8Array): string | null {
	const starts = (...bytes: number[]) => bytes.every((byte, i) => head[i] === byte);

	if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
	if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
	// RIFF....WEBP
	if (starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";

	const text = new TextDecoder().decode(head.slice(0, 128)).trimStart().toLowerCase();
	if (text.startsWith("<svg") || text.startsWith("<?xml")) return "image/svg+xml";

	return null;
}
