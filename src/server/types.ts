import type { Context, Middleware } from "@rabbit-company/web";
import type { CreatorRow } from "./db/creators.ts";
import type { SessionRow } from "./db/sessions.ts";

export interface AppState extends Record<string, unknown> {
	requestId: string;
	creator: CreatorRow;
	session: SessionRow;
	token: string;
	authSource: "cookie" | "bearer";
}

export type AppContext = Context<AppState>;
export type AppMiddleware = Middleware<AppState>;
