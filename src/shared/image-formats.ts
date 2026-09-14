function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
	return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function uint32be(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] ?? 0) * 0x1000000 + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0)) >>> 0;
}

function uint32le(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8) + ((bytes[offset + 2] ?? 0) << 16) + (bytes[offset + 3] ?? 0) * 0x1000000) >>> 0;
}

function animatedPng(bytes: Uint8Array): boolean {
	if (bytes.length < 20 || bytes[0] !== 0x89 || !ascii(bytes, 1, "PNG") || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a)
		return false;
	let offset = 8;
	while (offset + 12 <= bytes.length) {
		const size = uint32be(bytes, offset);
		if (ascii(bytes, offset + 4, "acTL")) return true;
		if (ascii(bytes, offset + 4, "IDAT") || size > bytes.length - offset - 12) return false;
		offset += 12 + size;
	}
	return false;
}

function animatedWebp(bytes: Uint8Array): boolean {
	if (bytes.length < 20 || !ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP")) return false;
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const size = uint32le(bytes, offset + 4);
		if (ascii(bytes, offset, "ANIM") || ascii(bytes, offset, "ANMF")) return true;
		if (ascii(bytes, offset, "VP8X") && size > 0 && offset + 8 < bytes.length && ((bytes[offset + 8] ?? 0) & 0x02) !== 0) return true;
		if (size > bytes.length - offset - 8) return false;
		offset += 8 + size + (size % 2);
	}
	return false;
}

export function imageHasAnimation(contentType: string, bytes: Uint8Array): boolean {
	const type = contentType.toLowerCase().split(";")[0]?.trim();
	if (type === "image/gif" || type === "image/apng" || type === "image/avif-sequence") return true;
	if (type === "image/png") return animatedPng(bytes);
	if (type === "image/webp") return animatedWebp(bytes);
	return false;
}

export function detectAvifType(bytes: Uint8Array): "image/avif" | "image/avif-sequence" | null {
	if (bytes.length < 16 || !ascii(bytes, 4, "ftyp")) return null;
	const declaredSize = uint32be(bytes, 0);
	const end = Math.min(declaredSize >= 16 ? declaredSize : bytes.length, bytes.length);
	let still = false;
	let sequence = false;

	for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
		if (ascii(bytes, offset, "avif")) still = true;
		if (ascii(bytes, offset, "avis")) sequence = true;
	}

	return sequence ? "image/avif-sequence" : still ? "image/avif" : null;
}
