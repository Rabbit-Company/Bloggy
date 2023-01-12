// The title of your Blog
var title = "Rabbit Company";
// The description of your Blog
var description = "Made with care and passion by Rabbit Company";

// Author / Owner of the blog
var author = "Rabbit Company";

// Username
var username = "rabbit-company";

// About what category does most of your blogs relate
var category = "Technology";

// The main language of your Blog
var language = "en";

// Social Media
var website = "https://rabbit-company.com";
var discord = "https://discord.rabbit-company.com";
var twitter = "https://twitter.com/RabbitCompany66";
var github = "https://github.com/Rabbit-Company";
var email = "info@rabbit-company.com";

var posts = {
	"why-are-password-managers-important": {
		title: "Why are password managers important?",
		description: "Password managers are an important tool for anyone who values online security and convenience. By using a password manager, you can protect your accounts with strong, unique passwords and access them easily with just one master password.",
		picture: "secure_files.svg",
		tag: "Password Manager",
		keywords: ["password managers", "password security", "password manager app", "password protection", "password management", "password generator", "password vault", "password encryption", "password best practices", "password safety"],
		date: "2023-01-04",
		read: 1
	},
	"the-importance-of-open-source-projects": {
		title: "The importance of Open Source projects",
		description: "Open source projects play a vital role in the technology ecosystem. They promote collaboration, innovation, and the sharing of knowledge and resources. As the digital world continues to evolve, it is important to support and foster the growth of open source projects.",
		picture: "open_source.svg",
		tag: "Open Source",
		keywords: ["Open Source", "Collaboration", "Innovation", "Community", "Transparency", "Flexibility", "Cost-effectiveness", "Security", "Interoperability", "Sustainability"],
		date: "2023-01-05",
		read: 2
	},
	"what-are-cryptocurrencies": {
		title: "What are Cryptocurrencies?",
		description: "Cryptocurrencies are digital or virtual currencies that use cryptography for secure financial transactions. They have gained a lot of attention in recent years due to their decentralized nature, as well as their potential to disrupt traditional financial systems.",
		picture: "bitcoin.svg",
		tag: "Crypto",
		keywords: ["cryptocurrency", "digital currency", "crypto", "blockchain technology", "bitcoin", "cryptocurrency trading", "crypto mining", "crypto wallet", "cryptocurrency exchange", "smart contract"],
		date: "2023-01-06",
		read: 2
	},
	"why-we-choose-plausible": {
		title: "Why we choose Plausible?",
		description: "There are many reasons why we choose Plausible for our web analytics needs. Its focus on privacy, lightweight and fast performance, ease of use, and affordability make it a top choice for websites looking for an alternative to Google Analytics.",
		picture: "dark_analytics.svg",
		tag: "Analytics",
		keywords: ["Plausible", "web analytics", "privacy-friendly analytics", "lightweight web analytics", "open-source analytics", "simple web analytics", "analytics for website", "web statistics", "web traffic analysis", "Plausible alternative"],
		date: "2023-01-06",
		read: 2
	},
	"why-you-should-choose-a-password-manager-that-uses-xchacha20-and-argon2id": {
		title: "Why you should choose a password manager that uses XChaCha20 and Argon2id",
		description: "Passky's use of XChaCha20 and Argon2id makes it a secure and reliable choice for storing and managing your passwords.",
		picture: "vault.svg",
		tag: "Password Manager",
		keywords: ["password manager", "XChaCha20", "Argon2id", "password encryption", "password security", "password hashing", "password best practices", "password manager app", "password protection", "password management"],
		date: "2023-01-06",
		read: 3
	},
	"why-you-should-use-a-hardware-wallet-to-store-your-cryptocurrencies": {
		title: "Why you should use a hardware wallet to store your cryptocurrencies",
		description: "Storing your cryptocurrencies on a hardware wallet like Ledger is a smart move that can help protect your funds from cyber attacks and other types of online threats.",
		picture: "bitcoin_p2p.svg",
		tag: "Crypto",
		keywords: ["hardware wallet", "cryptocurrency storage", "crypto security", "cold storage", "offline storage", "private key", "ledger", "trezor", "digital assets security", "crypto hardware"],
		date: "2023-01-06",
		read: 2
	},
	"why-you-should-use-a-yubikey-to-secure-your-accounts": {
		title: "Why you should use a Yubikey to secure your accounts",
		description: "YubiKey is a simple and effective way to secure your online accounts. It provides an extra layer of security, is easy to use, portable, durable, and offers secure storage in case it is lost.",
		picture: "security.svg",
		tag: "Security",
		keywords: ["Yubikey", "two-factor authentication", "security token", "authenticator", "passwordless login", "U2F", "FIDO2", "multi-factor authentication", "account security", "Yubico"],
		date: "2023-01-07",
		read: 2
	}
};

try{
	module.exports = {
		title,
		description,
		author,
		username,
		category,
		language,
		website,
		discord,
		twitter,
		github,
		email,
		posts
	};
}catch{};