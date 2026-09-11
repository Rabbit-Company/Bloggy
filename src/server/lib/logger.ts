import { createWebLogger } from "@rabbit-company/web-middleware/logger";
import { config } from "../config.ts";

/**
 * `@rabbit-company/logger` ships inside `@rabbit-company/web-middleware`, so it
 * is re-exported from there rather than pulled in as a separate dependency.
 * Additional transports (Loki, syslog) can be attached with `logger.addTransport`.
 */
export const logger = createWebLogger({
	level: config.logging.level,
	console: true,
});

export { Levels } from "@rabbit-company/web-middleware/logger";
