export enum ErrorCode {
	SUCCESS = 0,

	INVALID_JSON = 1000,
	MISSING_FIELDS = 1001,

	INVALID_USERNAME = 1002,
	INVALID_PASSWORD = 1003,
	INVALID_EMAIL = 1004,
	USERNAME_TAKEN = 1005,
	INVALID_OTP = 1006,
	INVALID_CREDENTIALS = 1007,
	DATABASE_ERROR = 1008,

	INVALID_TITLE = 1009,
	INVALID_DESCRIPTION = 1010,
	INVALID_AUTHOR = 1011,
	INVALID_CATEGORY = 1012,
	INVALID_LANGUAGE = 1013,
	INVALID_THEME = 1014,

	INVALID_TOKEN = 1015,
	UNAUTHORIZED = 1016,

	DELETE_FAILED = 1017,

	INVALID_POST_ID = 1018,
	INVALID_POST_TITLE = 1019,
	INVALID_POST_DESCRIPTION = 1020,
	INVALID_POST_PICTURE = 1021,
	INVALID_POST_MARKDOWN = 1022,
	INVALID_POST_TAG = 1023,
	INVALID_POST_KEYWORDS = 1024,
	POST_ID_TAKEN = 1025,
	WRITE_FAILED = 1026,
	POST_NOT_FOUND = 1027,

	FILE_TOO_LARGE = 1029,
	INVALID_IMAGE_NAME = 1030,
	MISSING_CONTENT_TYPE = 1031,
	UNSUPPORTED_FILE_TYPE = 1032,
	INVALID_SOCIAL = 1033,

	REGISTRATION_DISABLED = 1100,
	PASSWORD_TOO_WEAK = 1101,
	OTP_REQUIRED = 1102,
	TWO_FACTOR_ALREADY_ENABLED = 1103,
	TWO_FACTOR_NOT_ENABLED = 1104,
	RATE_LIMITED = 1105,
	CREATOR_NOT_FOUND = 1106,
	STORAGE_ERROR = 1107,
	NOT_FOUND = 1108,
	INTERNAL_ERROR = 1109,
	CSRF_REJECTED = 1110,
	INVALID_POST_STATUS = 1111,
	STORAGE_QUOTA_EXCEEDED = 1112,
	/** The account has been suspended by an administrator. */
	ACCOUNT_SUSPENDED = 1113,
	/** The caller is signed in but is not an administrator. */
	NOT_ADMIN = 1114,
	/** Backups are not possible on this instance, or are not configured. */
	BACKUP_UNAVAILABLE = 1115,
	/** The stored file is not a usable Bloggy database. */
	BACKUP_INVALID = 1116,
	/** An invitation cannot be used because it is missing, expired or consumed. */
	INVITE_INVALID = 1117,
	/** The supplied collaborator role is not supported. */
	INVALID_TEAM_ROLE = 1118,
	/** Password reset email is not configured on this instance. */
	PASSWORD_RESET_UNAVAILABLE = 1119,
	/** A password-reset token is missing, expired or already consumed. */
	PASSWORD_RESET_INVALID = 1120,
	/** The account cannot sign in until its email address is confirmed. */
	EMAIL_NOT_CONFIRMED = 1121,
	/** An email-confirmation token is missing, expired or already consumed. */
	EMAIL_CONFIRMATION_INVALID = 1122,
	/** A required account email could not be delivered. */
	EMAIL_DELIVERY_FAILED = 1123,
	/** Email confirmation is not configured on this instance. */
	EMAIL_CONFIRMATION_UNAVAILABLE = 1124,
	/** Custom colors, CSS or a page template did not pass validation. */
	INVALID_CUSTOMIZATION = 1125,
	/** A license key is malformed, unknown, revoked or already redeemed. */
	LICENSE_INVALID = 1126,
}
