// The title of your Blog
var title = "Bloggy";
// The description of your Blog
var description = "Simple and open source network for creators";

// Author / Owner of the blog
var author = "Rabbit Company";

// Provide the domain on where you will host Bloggy
var domain = "https://bloggy.io";

// About what category does most of your blogs relate
var category = "Technology";

// Plausible, Google Analytics...
var analytics = "<script defer data-domain='bloggy.io' src='https://analytics.rabbit-company.com/js/plausible.js'></script>";

// The main language of your Blog
var language = "en";

// From where do you want to retreive images (avatars, images included in posts...)?
var imagesLink = "https://cdn.bloggy.io";

// Set this to true if your URLs does not show .html extension for posts (Leave it to true if you are using Cloudflare Pages)
var extensionHidden = true;

// Social Media
var website = "https://rabbit-company.com";
var discord = "https://discord.rabbit-company.com";
var twitter = "https://twitter.com/RabbitCompany66";
var github = "https://github.com/Rabbit-Company";
var email = "info@rabbit-company.com";

try{
	module.exports = {
		title,
		description,
		author,
		domain,
		category,
		analytics,
		language,
		imagesLink,
		extensionHidden,
		website,
		discord,
		twitter,
		github,
		email
	};
}catch{};