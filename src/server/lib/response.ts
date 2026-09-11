import type { Context } from "@rabbit-company/web";
import { ApiError, ErrorCode, errorMessage, errorStatus } from "./errors.ts";

export interface ApiResponse<T = unknown> {
	error: ErrorCode;
	info: string;
	data?: T;
}

export function ok<T>(ctx: Context<any, any>, data?: T, status = 200): Response {
	const body: ApiResponse<T> = { error: ErrorCode.SUCCESS, info: errorMessage(ErrorCode.SUCCESS) };
	if (data !== undefined) body.data = data;
	return ctx.json(body, status);
}

export function fail(ctx: Context<any, any>, code: ErrorCode, info?: string, details?: Record<string, unknown>): Response {
	return ctx.json({ error: code, info: info ?? errorMessage(code), ...details }, errorStatus(code));
}

export function failFromError(ctx: Context<any, any>, err: unknown): Response {
	if (err instanceof ApiError) {
		return ctx.json({ error: err.code, info: err.message, ...err.details }, err.status);
	}
	return ctx.json({ error: ErrorCode.INTERNAL_ERROR, info: errorMessage(ErrorCode.INTERNAL_ERROR) }, 500);
}

export async function jsonBody<T>(ctx: Context<any, any>): Promise<T> {
	try {
		const body = await ctx.body<T>();
		if (body === null || typeof body !== "object") throw new Error("not an object");
		return body;
	} catch {
		throw new ApiError(ErrorCode.INVALID_JSON);
	}
}

export function requireFields<T extends Record<string, unknown>>(body: T, fields: (keyof T & string)[]): void {
	const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === "");
	if (missing.length > 0) {
		throw new ApiError(ErrorCode.MISSING_FIELDS, `Not all required data provided in JSON format. Required data: ${fields.join(", ")}`, {
			missing,
		});
	}
}
