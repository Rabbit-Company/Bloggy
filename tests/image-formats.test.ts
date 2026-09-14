import { describe, expect, test } from "bun:test";
import { compressImage } from "../src/panel/ui.ts";
import { detectImageType } from "../src/server/lib/image-type.ts";
import { isImageTypeSupported } from "../src/server/lib/validation.ts";
import { detectAvifType, imageHasAnimation } from "../src/shared/image-formats.ts";

function bytes(value: string): Uint8Array {
	return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

function avif(brand: "avif" | "avis"): Uint8Array {
	const result = new Uint8Array(20);
	result.set([0, 0, 0, 20], 0);
	result.set(bytes("ftyp"), 4);
	result.set(bytes(brand), 8);
	result.set(bytes(brand), 16);
	return result;
}

describe("animated image formats", () => {
	test("recognizes animated WebP without decoding its frames", () => {
		const webp = new Uint8Array(30);
		webp.set(bytes("RIFF"), 0);
		webp.set(bytes("WEBP"), 8);
		webp.set(bytes("VP8X"), 12);
		webp.set([10, 0, 0, 0], 16);
		webp[20] = 0x02;
		expect(imageHasAnimation("image/webp", webp)).toBe(true);
		webp[20] = 0;
		expect(imageHasAnimation("image/webp", webp)).toBe(false);
	});

	test("recognizes APNG by its animation control chunk", () => {
		const png = new Uint8Array(28);
		png.set([0x89, ...bytes("PNG"), 0x0d, 0x0a, 0x1a, 0x0a], 0);
		png.set([0, 0, 0, 8], 8);
		png.set(bytes("acTL"), 12);
		expect(imageHasAnimation("image/png", png)).toBe(true);
	});

	test("recognizes still and animated AVIF brands", () => {
		expect(detectAvifType(avif("avif"))).toBe("image/avif");
		expect(detectImageType(avif("avif"))).toBe("image/avif");
		expect(detectAvifType(avif("avis"))).toBe("image/avif-sequence");
		expect(detectImageType(avif("avis"))).toBe("image/avif-sequence");
		expect(imageHasAnimation("image/avif-sequence", new Uint8Array())).toBe(true);
	});

	test("accepts modern animation MIME types", () => {
		expect(isImageTypeSupported("image/apng")).toBe(true);
		expect(isImageTypeSupported("image/avif")).toBe(true);
		expect(isImageTypeSupported("image/avif-sequence")).toBe(true);
	});

	test("passes animated files through without flattening them", async () => {
		const gif = new File([bytes("GIF89a").buffer as ArrayBuffer], "animated.gif", { type: "image/gif" });
		const animatedAvif = new File([avif("avis").buffer as ArrayBuffer], "animated.avif", { type: "image/avif" });
		expect(await compressImage(gif, { maxWidth: 10, maxBytes: 100 })).toBe(gif);
		expect(await compressImage(animatedAvif, { maxWidth: 10, maxBytes: 100 })).toBe(animatedAvif);
	});
});
