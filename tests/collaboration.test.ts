import { beforeAll, describe, expect, test } from "bun:test";
import { createSession } from "../src/server/auth/sessions.ts";
import { insertCreator } from "../src/server/db/creators.ts";
import { sql } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { findPost, insertPost, type PostInput } from "../src/server/db/posts.ts";
import {
	acceptTeamInvite,
	consumeTeamInvite,
	createTeamInvite,
	findTeamInvite,
	insertTeamMember,
	listTeamInvites,
	listTeamMembers,
} from "../src/server/db/team.ts";
import { createApp } from "../src/server/index.ts";
import { hashPassword } from "../src/server/lib/crypto.ts";

const OWNER = "collab-owner";
const WRITER_PASSWORD = "a-correct-horse-battery-staple-for-writer";
const WORDS = Array.from({ length: 160 }, (_, index) => `word${index}`).join(" ");

function post(slug: string, status: PostInput["status"] = "draft"): PostInput {
	return {
		slug,
		title: "A complete collaborative article",
		description: "A complete description for the collaborative article under review.",
		picture: "https://example.com/cover.jpg",
		markdown: WORDS,
		category: "Technology",
		language: "en",
		tag: "Writing",
		keywords: "team,review,publishing",
		status,
	};
}

async function call(path: string, token: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${token}`);
	if (typeof init.body === "string") headers.set("Content-Type", "application/json");
	return await createApp().handle(new Request(`http://localhost:3000${path}`, { ...init, headers }));
}

beforeAll(async () => {
	await migrate();
	await sql`DELETE FROM team_invites`;
	await sql`DELETE FROM team_members`;
	await sql`DELETE FROM sessions`;
	await sql`DELETE FROM posts`;
	await sql`DELETE FROM creators`;

	await insertCreator({
		username: OWNER,
		password: "unused",
		email: "owner@example.com",
		title: "Collaborative Blog",
		description: "A shared publication with an intentionally thorough description.",
		author: "Owner Person",
		category: "Technology",
		language: "en",
		theme: "light",
	});
	await insertTeamMember({
		username: "team-writer",
		blogUsername: OWNER,
		password: await hashPassword(WRITER_PASSWORD),
		email: "writer@example.com",
		role: "writer",
	});
	await insertTeamMember({ username: "team-publisher", blogUsername: OWNER, password: "unused", email: "publisher@example.com", role: "publisher" });
	await insertPost(OWNER, post("another-draft"), 160, 1, "someone-else");
});

describe("team invitations", () => {
	test("stores only a hashed, expiring, one-use invitation", async () => {
		const created = await createTeamInvite(OWNER, "editor@example.com", "editor");
		expect((await listTeamInvites(OWNER))[0]?.id).not.toBe(created.token);
		expect((await findTeamInvite(created.token))?.role).toBe("editor");
		await consumeTeamInvite(created.token);
		expect(await findTeamInvite(created.token)).toBeNull();
	});

	test("lists a member without exposing their password hash", async () => {
		const member = (await listTeamMembers(OWNER)).find((entry) => entry.username === "team-writer");
		expect(member).toEqual(expect.objectContaining({ email: "writer@example.com", role: "writer" }));
		expect(member).not.toHaveProperty("password");
	});

	test("accepts an invitation exactly once", async () => {
		const created = await createTeamInvite(OWNER, "once@example.com", "writer");
		expect((await acceptTeamInvite(created.token, "invited-once", "password-hash"))?.email).toBe("once@example.com");
		expect(await acceptTeamInvite(created.token, "invited-twice", "password-hash")).toBeNull();
	});

	test("keeps invitation tokens out of panel and API paths", async () => {
		const owner = await createSession(OWNER);
		const created = await call("/api/v1/team/invitations", owner.token, {
			method: "POST",
			body: JSON.stringify({ email: "fragment@example.com", role: "writer" }),
		});
		expect(created.status).toBe(201);
		const envelope = (await created.json()) as { data: { inviteUrl: string } };
		const inviteUrl = new URL(envelope.data.inviteUrl);
		expect(inviteUrl.pathname).toBe("/panel/invite");
		expect(inviteUrl.hash.length).toBe(65);

		const token = inviteUrl.hash.slice(1);
		const lookup = await createApp().handle(
			new Request("http://localhost:3000/api/v1/team/invitations/lookup", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token }),
			}),
		);
		expect(lookup.status).toBe(200);

		const legacy = await createApp().handle(new Request(`http://localhost:3000/api/v1/team/invitations/${token}`));
		expect(legacy.status).toBe(404);
	});

	test("lets the owner change a member's role", async () => {
		const { token } = await createSession(OWNER);
		const response = await call("/api/v1/team/members/team-writer", token, {
			method: "PUT",
			body: JSON.stringify({ role: "editor" }),
		});
		expect(response.status).toBe(200);
		expect((await listTeamMembers(OWNER)).find((member) => member.username === "team-writer")?.role).toBe("editor");
		await call("/api/v1/team/members/team-writer", token, { method: "PUT", body: JSON.stringify({ role: "writer" }) });
	});
});

describe("collaborator authentication", () => {
	test("signs in to the owner's blog with the member's identity and email", async () => {
		const response = await createApp().handle(
			new Request("http://localhost:3000/api/v1/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: "team-writer", password: WRITER_PASSWORD }),
			}),
		);
		expect(response.status).toBe(200);
		const envelope = (await response.json()) as { data: { creator: { username: string; email: string; membership: Record<string, unknown> } } };
		expect(envelope.data.creator).toEqual(
			expect.objectContaining({
				username: OWNER,
				email: "writer@example.com",
				membership: expect.objectContaining({ username: "team-writer", role: "writer", canPublish: false }),
			}),
		);
	});
});

describe("post review permissions", () => {
	test("a writer can submit a post for review but cannot publish", async () => {
		const { token } = await createSession("team-writer");
		const denied = await call("/api/v1/posts", token, { method: "POST", body: JSON.stringify(post("writer-published", "published")) });
		expect(denied.status).toBe(401);

		const submitted = await call("/api/v1/posts", token, { method: "POST", body: JSON.stringify(post("writer-review", "review")) });
		expect(submitted.status).toBe(201);
		expect((await findPost(OWNER, "writer-review"))?.created_by).toBe("team-writer");
	});

	test("a writer cannot read another writer's unpublished post", async () => {
		const { token } = await createSession("team-writer");
		const response = await call("/api/v1/posts/another-draft", token);
		expect(response.status).toBe(404);
	});

	test("a writer cannot manage the team", async () => {
		const { token } = await createSession("team-writer");
		const response = await call("/api/v1/team", token);
		expect(response.status).toBe(401);
	});

	test("a publisher can request changes and the writer can resubmit", async () => {
		await insertPost(OWNER, post("needs-revision", "review"), 160, 1, "team-writer");
		const publisher = await createSession("team-publisher");
		const requested = await call("/api/v1/posts/needs-revision/request-changes", publisher.token, {
			method: "POST",
			body: JSON.stringify({ note: "Please add a concrete example." }),
		});
		expect(requested.status).toBe(200);
		expect(await findPost(OWNER, "needs-revision")).toEqual(
			expect.objectContaining({ status: "changes", review_note: "Please add a concrete example.", updated_by: "team-publisher" }),
		);

		const writer = await createSession("team-writer");
		const resubmitted = await call("/api/v1/posts/needs-revision", writer.token, {
			method: "PUT",
			body: JSON.stringify(post("needs-revision", "review")),
		});
		expect(resubmitted.status).toBe(200);
		expect(await findPost(OWNER, "needs-revision")).toEqual(expect.objectContaining({ status: "review", review_note: "", updated_by: "team-writer" }));
	});

	test("a publisher can publish a submitted post", async () => {
		await insertPost(OWNER, post("ready-to-publish", "review"), 160, 1, "team-writer");
		const { token } = await createSession("team-publisher");
		const response = await call("/api/v1/posts/ready-to-publish", token, {
			method: "PUT",
			body: JSON.stringify(post("ready-to-publish", "published")),
		});
		expect(response.status).toBe(200);
		const published = await findPost(OWNER, "ready-to-publish");
		expect(published?.status).toBe("published");
		expect(published?.updated_by).toBe("team-publisher");
		expect(published?.published_at).not.toBeNull();
	});
});
