export const HOME_TEMPLATE_COMPONENTS = ["bloggy-header", "bloggy-search", "bloggy-filter", "bloggy-posts", "bloggy-pagination"] as const;
export const POST_TEMPLATE_COMPONENTS = [
	"bloggy-header",
	"bloggy-preview",
	"bloggy-post-title",
	"bloggy-byline",
	"bloggy-post-content",
	"bloggy-share",
] as const;

export const HOME_STARTER_TEMPLATE = `<main class="custom-home wrap">
  <bloggy-header></bloggy-header>
  <bloggy-search></bloggy-search>
  <bloggy-filter></bloggy-filter>
  <bloggy-posts></bloggy-posts>
  <bloggy-pagination></bloggy-pagination>
</main>`;

export const POST_STARTER_TEMPLATE = `<main class="custom-post wrap">
  <bloggy-header></bloggy-header>
  <article class="post narrow">
    <bloggy-preview></bloggy-preview>
    <bloggy-post-title></bloggy-post-title>
    <bloggy-byline></bloggy-byline>
    <bloggy-post-content></bloggy-post-content>
    <bloggy-share></bloggy-share>
  </article>
</main>`;

export interface CreatorCustomizationInput {
	customCss: string;
	homeTemplate: string;
	postTemplate: string;
}
