import { Levels } from "@rabbit-company/web-middleware/logger";
import type { IpExtractionPreset } from "@rabbit-company/web-middleware/ip-extract";

export type StorageDriver = "local" | "s3";
export type DatabaseDialect = "sqlite" | "postgres" | "mysql" | "mariadb";
export type CustomDomainProvider = "disabled" | "cloudflare" | "burrowgate" | "manual";

function required(name: string): string {
	const value = process.env[name];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`);
	}
	return value.trim();
}

function str(name: string, fallback: string): string {
	const value = process.env[name];
	if (typeof value !== "string" || value.trim().length === 0) return fallback;
	return value.trim();
}

function int(name: string, fallback: number): number {
	const value = process.env[name];
	if (typeof value !== "string" || value.trim().length === 0) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Environment variable ${name} must be an integer, got: ${value}`);
	}
	return parsed;
}

function bool(name: string, fallback: boolean): boolean {
	const value = process.env[name];
	if (typeof value !== "string" || value.trim().length === 0) return fallback;
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function origin(name: string, fallback: string): string {
	return str(name, fallback).replace(/\/+$/, "");
}

function detectDialect(url: string): DatabaseDialect {
	const scheme = url.split(":")[0]?.toLowerCase();
	switch (scheme) {
		case "sqlite":
		case "file":
			return "sqlite";
		case "postgres":
		case "postgresql":
			return "postgres";
		case "mysql":
			return "mysql";
		case "mariadb":
			return "mariadb";
		default:
			throw new Error(`Unsupported DATABASE_URL scheme "${scheme}". Use one of: sqlite://, postgres://, mysql://, mariadb://`);
	}
}

const databaseUrl = str("DATABASE_URL", "sqlite://./data/bloggy.sqlite");
const storageDriver = str("STORAGE_DRIVER", "local") as StorageDriver;
if (storageDriver !== "local" && storageDriver !== "s3") {
	throw new Error(`STORAGE_DRIVER must be "local" or "s3", got: ${storageDriver}`);
}

const domain = origin("DOMAIN", "http://localhost:3000");
const customDomainProvider = str("CUSTOM_DOMAIN_PROVIDER", "disabled") as CustomDomainProvider;
if (!["disabled", "cloudflare", "burrowgate", "manual"].includes(customDomainProvider)) {
	throw new Error(`CUSTOM_DOMAIN_PROVIDER must be "disabled", "cloudflare", "burrowgate" or "manual", got: ${customDomainProvider}`);
}
const apiOriginsRaw = str("API_ORIGINS", "");
const smtpHost = str("SMTP_HOST", "");
const smtpFrom = str("SMTP_FROM", "");
const smtpUser = str("SMTP_USER", "");
const smtpPassword = str("SMTP_PASSWORD", "");
if ((smtpUser.length === 0) !== (smtpPassword.length === 0)) {
	throw new Error("SMTP_USER and SMTP_PASSWORD must either both be set or both be empty.");
}

export const config = {
	server: {
		port: int("PORT", 3000),
		// Named BIND_ADDRESS rather than HOSTNAME: the shell and every Docker
		// container already export HOSTNAME, and a real environment variable
		// takes precedence over .env, which would silently bind the server to
		// the machine's hostname instead of all interfaces.
		hostname: str("BIND_ADDRESS", "0.0.0.0"),
		domain,
		apiOrigins: apiOriginsRaw.length === 0 ? [] : apiOriginsRaw.split(",").map((o) => o.trim().replace(/\/+$/, "")),
		trustProxy: str("TRUST_PROXY", "direct") as IpExtractionPreset,
	},

	database: {
		url: databaseUrl,
		dialect: detectDialect(databaseUrl),
		poolSize: int("DATABASE_POOL_SIZE", 10),
	},

	secrets: {
		encryptionKey: required("ENCRYPTION_KEY"),
		adminToken: str("ADMIN_TOKEN", ""),
	},

	smtp: {
		enabled: smtpHost.length > 0 && smtpFrom.length > 0,
		host: smtpHost,
		port: Math.max(1, Math.min(65_535, int("SMTP_PORT", 587))),
		secure: bool("SMTP_SECURE", false),
		requireTls: bool("SMTP_REQUIRE_TLS", true),
		user: smtpUser,
		password: smtpPassword,
		from: smtpFrom,
	},

	storage: {
		driver: storageDriver,
		path: str("STORAGE_PATH", "./data/media"),
		s3: {
			bucket: str("S3_BUCKET", ""),
			endpoint: str("S3_ENDPOINT", ""),
			region: str("S3_REGION", "auto"),
			accessKeyId: str("S3_ACCESS_KEY_ID", ""),
			secretAccessKey: str("S3_SECRET_ACCESS_KEY", ""),
		},
		cdnUrl: origin("CDN_URL", `${domain}/media`),
	},

	site: {
		title: str("SITE_TITLE", "Bloggy"),
		description: str("SITE_DESCRIPTION", "Easy-to-use blogging platform for creators."),
		author: str("SITE_AUTHOR", "Bloggy"),
		language: str("SITE_LANGUAGE", "en"),
		website: str("SITE_WEBSITE", ""),
		discord: str("SITE_DISCORD", ""),
		github: str("SITE_GITHUB", ""),
		twitter: str("SITE_TWITTER", ""),
		analytics: str("SITE_ANALYTICS", ""),
	},

	limits: {
		registrationEnabled: bool("REGISTRATION_ENABLED", true),
		minPasswordEntropy: int("MIN_PASSWORD_ENTROPY", 75),
		sessionTtl: int("SESSION_TTL", 2_592_000),
		maxAvatarSize: int("MAX_AVATAR_SIZE", 300_000),
		maxImageSize: int("MAX_IMAGE_SIZE", 1_000_000),
		maxAccountStorage: int("MAX_ACCOUNT_STORAGE", 100_000_000),
		passwordResetTtl: Math.max(300, Math.min(86_400, int("PASSWORD_RESET_TTL", 3_600))),
		emailConfirmationTtl: Math.max(900, Math.min(604_800, int("EMAIL_CONFIRMATION_TTL", 86_400))),
	},

	/**
	 * Scheduled snapshots of the SQLite database to object storage.
	 *
	 * Its own bucket and credentials rather than the media ones: a snapshot
	 * holds every password hash and email address, and the media bucket is
	 * public whenever CDN_URL is set.
	 */
	backup: {
		enabled: bool("BACKUP_ENABLED", false),
		intervalSeconds: int("BACKUP_INTERVAL", 86_400),
		/** How many snapshots to keep. The oldest are pruned after each run. */
		keep: int("BACKUP_KEEP", 7),
		prefix: str("BACKUP_PREFIX", "backups"),
		s3: {
			bucket: str("BACKUP_S3_BUCKET", ""),
			endpoint: str("BACKUP_S3_ENDPOINT", ""),
			region: str("BACKUP_S3_REGION", "auto"),
			accessKeyId: str("BACKUP_S3_ACCESS_KEY_ID", ""),
			secretAccessKey: str("BACKUP_S3_SECRET_ACCESS_KEY", ""),
		},
	},

	cache: {
		ttl: int("CACHE_TTL", 300),
		maxEntries: int("CACHE_MAX_ENTRIES", 1000),
	},

	logging: {
		level: int("LOG_LEVEL", Levels.INFO) as Levels,
	},

	metrics: {
		enabled: bool("METRICS_ENABLED", true),
	},

	burrowgate: {
		url: origin("BURROWGATE_URL", ""),
		token: str("BURROWGATE_TOKEN", ""),
		siteId: str("BURROWGATE_SITE_ID", ""),
	},

	customDomains: {
		provider: customDomainProvider,
		cnameTarget: str("CUSTOM_DOMAIN_CNAME_TARGET", "").toLowerCase().replace(/\.$/, ""),
		cloudflare: {
			apiToken: str("CLOUDFLARE_API_TOKEN", ""),
			zoneId: str("CLOUDFLARE_ZONE_ID", ""),
		},
		burrowgate: {
			adminToken: str("BURROWGATE_ADMIN_TOKEN", ""),
			originUrl: origin("BURROWGATE_CUSTOM_DOMAIN_ORIGIN", ""),
			acmeEmail: str("BURROWGATE_ACME_EMAIL", ""),
		},
	},
} as const;

export type Config = typeof config;
