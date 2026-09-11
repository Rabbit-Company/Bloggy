/**
 * The only JavaScript the public blog serves.
 *
 * It upgrades the "Load more posts" link into the infinite scroll the original
 * Bloggy had. The link is a real, crawlable URL and works on its own, so this
 * changes how the page feels rather than whether it works: with JavaScript off,
 * or before this file loads, the same pages are still reachable by clicking.
 *
 * Written as a module constant rather than read from disk for the same reason
 * as the stylesheet, so a compiled single-file binary still serves it.
 */
export const BLOG_JS = `
(() => {
	const grid = document.querySelector(".grid");
	const more = document.querySelector("a.more");
	if (grid === null || more === null) return;

	let next = more.getAttribute("href");
	let loading = false;

	const stop = () => {
		observer.disconnect();
		more.closest(".more-wrap").remove();
	};

	async function load() {
		if (loading || next === null) return;
		loading = true;
		more.textContent = "Loading…";

		try {
			const response = await fetch(next, { headers: { Accept: "text/html" } });
			if (!response.ok) throw new Error(String(response.status));

			const page = new DOMParser().parseFromString(await response.text(), "text/html");
			const cards = page.querySelectorAll(".grid > .card");
			// A page with nothing on it means the listing ended between requests.
			if (cards.length === 0) return stop();

			for (const card of cards) grid.append(document.importNode(card, true));

			const link = page.querySelector("a.more");
			next = link === null ? null : link.getAttribute("href");
			if (next === null) return stop();

			more.setAttribute("href", next);
			more.textContent = "Load more posts";
		} catch {
			// Leave the link in place so it can be clicked, or retried on scroll.
			more.textContent = "Load more posts";
		} finally {
			loading = false;
		}
	}

	// Fires a little before the link reaches the viewport, so the next page is
	// usually already there by the time the reader gets to the bottom.
	const observer = new IntersectionObserver((entries) => {
		if (entries.some((entry) => entry.isIntersecting)) void load();
	}, { rootMargin: "400px" });

	observer.observe(more);
	more.addEventListener("click", (event) => {
		event.preventDefault();
		void load();
	});
})();
`.trim();
