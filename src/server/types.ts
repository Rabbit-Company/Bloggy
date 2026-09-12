import type { Context, Middleware } from "@rabbit-company/web";
import type { CreatorRow } from "./db/creators.ts";
import type { SessionRow } from "./db/sessions.ts";
import type { TeamMemberRow, TeamRole } from "./db/team.ts";

export interface AuthActor {
	username: string;
	role: "owner" | TeamRole;
	isOwner: boolean;
	canPublish: boolean;
	canEditAll: boolean;
	member: TeamMemberRow | null;
}

export interface AppState extends Record<string, unknown> {
	requestId: string;
	creator: CreatorRow;
	session: SessionRow;
	token: string;
	authSource: "cookie" | "bearer";
	actor: AuthActor;
}

export type AppContext = Context<AppState>;
export type AppMiddleware = Middleware<AppState>;
