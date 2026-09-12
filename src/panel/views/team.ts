import { api, type TeamInvitation, type TeamMember, type TeamRole } from "../api.ts";
import { confirm, el, formatDate, render, toast } from "../ui.ts";

const ROLES: { value: TeamRole; label: string; description: string }[] = [
	{ value: "writer", label: "Writer", description: "Creates and edits their own drafts, then submits them for review." },
	{ value: "editor", label: "Editor", description: "Edits every unpublished post and submits work for review." },
	{ value: "publisher", label: "Publisher", description: "Reviews, publishes and manages every post." },
];

function roleSelect(selected: TeamRole): HTMLSelectElement {
	const select = el("select", { class: "input", "aria-label": "Role" });
	for (const role of ROLES) select.append(el("option", { value: role.value, selected: role.value === selected }, role.label));
	return select;
}

function invitationRow(invitation: TeamInvitation, reload: () => void): HTMLTableRowElement {
	const revoke = el("button", { class: "button small ghost" }, "Revoke");
	revoke.addEventListener("click", async () => {
		try {
			await api.revokeInvitation(invitation.id);
			toast("Invitation revoked.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not revoke the invitation.", "error");
		}
	});
	return el(
		"tr",
		{},
		el("td", {}, invitation.email),
		el("td", {}, el("span", { class: "badge" }, invitation.role)),
		el("td", {}, formatDate(invitation.expiresAt)),
		el("td", { class: "row-actions" }, revoke),
	);
}

function memberRow(member: TeamMember, reload: () => void): HTMLTableRowElement {
	const select = roleSelect(member.role);
	select.addEventListener("change", async () => {
		select.disabled = true;
		try {
			await api.updateTeamMember(member.username, select.value as TeamRole);
			toast(`${member.username}'s role was updated.`, "success");
		} catch (err) {
			select.value = member.role;
			toast(err instanceof Error ? err.message : "Could not update the role.", "error");
		} finally {
			select.disabled = false;
		}
	});

	const remove = el("button", { class: "button small danger" }, "Remove");
	remove.addEventListener("click", async () => {
		const approved = await confirm({
			title: `Remove ${member.username}?`,
			body: [el("p", {}, "They will be signed out and immediately lose access. Their posts stay with the blog.")],
			confirmLabel: "Remove access",
			danger: true,
		});
		if (!approved) return;
		try {
			await api.removeTeamMember(member.username);
			toast("Team member removed.", "success");
			reload();
		} catch (err) {
			toast(err instanceof Error ? err.message : "Could not remove this team member.", "error");
		}
	});

	return el(
		"tr",
		{},
		el("td", {}, el("strong", {}, member.username), el("span", { class: "sub" }, member.email)),
		el("td", {}, select),
		el("td", {}, formatDate(member.accessedAt)),
		el("td", { class: "row-actions" }, remove),
	);
}

export async function renderTeam(root: HTMLElement): Promise<void> {
	render(root, el("div", { class: "loading" }, el("span", { class: "spinner" }), " Loading your team…"));
	let data: { members: TeamMember[]; invitations: TeamInvitation[] };
	try {
		data = await api.team();
	} catch (err) {
		render(root, el("div", { class: "empty" }, err instanceof Error ? err.message : "Could not load your team."));
		return;
	}

	const reload = () => void renderTeam(root);
	const email = el("input", { id: "invite-email", type: "email", autocomplete: "email", placeholder: "writer@example.com" });
	const role = roleSelect("writer");
	role.id = "invite-role";
	const submit = el("button", { class: "button primary", type: "submit" }, "Create invite link");
	const result = el("div", { class: "invite-result" });

	const form = el(
		"form",
		{
			class: "invite-form",
			onSubmit: async (event: Event) => {
				event.preventDefault();
				submit.disabled = true;
				try {
					const created = await api.inviteTeamMember(email.value.trim(), role.value as TeamRole);
					const url = el("input", { value: created.inviteUrl, readonly: true, "aria-label": "Invitation link" });
					const copy = el("button", { class: "button ghost", type: "button" }, "Copy link");
					copy.addEventListener("click", async () => {
						try {
							await navigator.clipboard.writeText(created.inviteUrl);
							toast("Invite link copied.", "success");
						} catch {
							url.select();
							toast("Copy is unavailable here. The link is selected for you.", "info");
						}
					});
					render(
						result,
						el("strong", {}, "Invitation ready"),
						el("p", {}, "Share this private link. It expires in 7 days and works once."),
						el("div", { class: "invite-link" }, url, copy),
					);
					email.value = "";
				} catch (err) {
					toast(err instanceof Error ? err.message : "Could not create the invitation.", "error");
				} finally {
					submit.disabled = false;
				}
			},
		},
		el("label", { class: "field", for: email.id }, el("span", {}, "Email"), email),
		el("label", { class: "field", for: role.id }, el("span", {}, "Role"), role),
		submit,
	);

	const members = el(
		"div",
		{ class: "table-wrap" },
		el(
			"table",
			{ class: "admin-table" },
			el("thead", {}, el("tr", {}, el("th", {}, "Member"), el("th", {}, "Role"), el("th", {}, "Last active"), el("th", {}, ""))),
			el("tbody", {}, ...data.members.map((member) => memberRow(member, reload))),
		),
	);

	const invitations = el(
		"div",
		{ class: "table-wrap" },
		el(
			"table",
			{ class: "admin-table" },
			el("thead", {}, el("tr", {}, el("th", {}, "Email"), el("th", {}, "Role"), el("th", {}, "Expires"), el("th", {}, ""))),
			el("tbody", {}, ...data.invitations.map((invite) => invitationRow(invite, reload))),
		),
	);

	render(
		root,
		el("div", { class: "page-head" }, el("div", {}, el("h1", {}, "Team"), el("p", {}, "Invite collaborators without sharing your owner password."))),
		el("div", { class: "role-grid" }, ...ROLES.map((item) => el("div", { class: "role-card" }, el("strong", {}, item.label), el("p", {}, item.description)))),
		el(
			"section",
			{ class: "card" },
			el("h2", {}, "Invite someone"),
			el("p", { class: "hint" }, "Bloggy creates a secure link for you to send through your preferred channel."),
			form,
			result,
		),
		el("h2", { class: "section-heading" }, `Members (${data.members.length})`),
		data.members.length > 0 ? members : el("div", { class: "empty compact" }, "No collaborators have joined yet."),
		data.invitations.length > 0 && el("h2", { class: "section-heading team-pending" }, "Pending invitations"),
		data.invitations.length > 0 && invitations,
	);
}
