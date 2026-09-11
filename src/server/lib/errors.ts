export { ErrorCode } from "../../shared/errors.ts";
import { ErrorCode } from "../../shared/errors.ts";

const messages: Record<ErrorCode, string> = {
	[ErrorCode.SUCCESS]: "Success",

	[ErrorCode.INVALID_JSON]: "Data needs to be submitted in JSON format.",
	[ErrorCode.MISSING_FIELDS]: "Not all required data was provided.",

	[ErrorCode.INVALID_USERNAME]:
		"Username can only contain lowercase characters, numbers and hyphens. It also needs to start with a lowercase character and be between 4 and 30 characters long.",
	[ErrorCode.INVALID_PASSWORD]: "Password needs to be between 8 and 256 characters long.",
	[ErrorCode.INVALID_EMAIL]: "Invalid email address.",
	[ErrorCode.USERNAME_TAKEN]: "Username is already registered.",
	[ErrorCode.INVALID_OTP]: "OTP is invalid.",
	[ErrorCode.INVALID_CREDENTIALS]: "Username or password is incorrect.",
	[ErrorCode.DATABASE_ERROR]: "Something went wrong while connecting to the database.",

	[ErrorCode.INVALID_TITLE]: "Title needs to be between 3 and 30 characters long.",
	[ErrorCode.INVALID_DESCRIPTION]: "Description needs to be between 30 and 160 characters long.",
	[ErrorCode.INVALID_AUTHOR]: "Author needs to be between 5 and 30 characters long.",
	[ErrorCode.INVALID_CATEGORY]: "Category is invalid.",
	[ErrorCode.INVALID_LANGUAGE]: "Language is invalid. Please use ISO 639-1.",
	[ErrorCode.INVALID_THEME]: "Theme is invalid.",

	[ErrorCode.INVALID_TOKEN]: "Token is invalid or has expired. Please log in again.",
	[ErrorCode.UNAUTHORIZED]: "You are not authorized to perform this action.",

	[ErrorCode.DELETE_FAILED]: "Something went wrong while deleting. Please try again later.",

	[ErrorCode.INVALID_POST_ID]: "Post ID can only contain lowercase characters, numbers and hyphens. It also needs to be between 5 and 100 characters long.",
	[ErrorCode.INVALID_POST_TITLE]: "Title needs to be between 5 and 100 characters long.",
	[ErrorCode.INVALID_POST_DESCRIPTION]: "Description needs to be between 30 and 300 characters long.",
	[ErrorCode.INVALID_POST_PICTURE]: "Picture needs to be between 5 and 500 characters long.",
	[ErrorCode.INVALID_POST_MARKDOWN]: "Post needs to be between 150 and 10000 words long.",
	[ErrorCode.INVALID_POST_TAG]: "Tag needs to be between 3 and 30 characters long.",
	[ErrorCode.INVALID_POST_KEYWORDS]:
		"You need between 3 and 20 keywords. Keywords need to be separated with a comma and the string can't be longer than 255 characters.",
	[ErrorCode.POST_ID_TAKEN]: "Post ID is already taken. Please use another post ID.",
	[ErrorCode.WRITE_FAILED]: "Something went wrong while saving your changes.",
	[ErrorCode.POST_NOT_FOUND]: "This post doesn't exist.",

	[ErrorCode.FILE_TOO_LARGE]: "The uploaded file is too large.",
	[ErrorCode.INVALID_IMAGE_NAME]: "Image name is invalid.",
	[ErrorCode.MISSING_CONTENT_TYPE]: "Content-Type header needs to be provided.",
	[ErrorCode.UNSUPPORTED_FILE_TYPE]: "File type is not supported. Please upload .png, .jpg, .gif, .svg or .webp",
	[ErrorCode.INVALID_SOCIAL]: "Social media is invalid.",

	[ErrorCode.REGISTRATION_DISABLED]: "Registration is disabled on this instance.",
	[ErrorCode.PASSWORD_TOO_WEAK]: "Password is too weak. Please choose a longer or more varied password.",
	[ErrorCode.OTP_REQUIRED]: "This account has two-factor authentication enabled. Please provide your OTP.",
	[ErrorCode.TWO_FACTOR_ALREADY_ENABLED]: "Two-factor authentication is already enabled.",
	[ErrorCode.TWO_FACTOR_NOT_ENABLED]: "Two-factor authentication is not enabled.",
	[ErrorCode.RATE_LIMITED]: "Too many requests. Please slow down.",
	[ErrorCode.CREATOR_NOT_FOUND]: "This creator doesn't exist.",
	[ErrorCode.STORAGE_ERROR]: "Something went wrong while storing the file.",
	[ErrorCode.NOT_FOUND]: "Not found.",
	[ErrorCode.INTERNAL_ERROR]: "Internal server error.",
	[ErrorCode.CSRF_REJECTED]: "This request was blocked because it did not come from the panel.",
	[ErrorCode.INVALID_POST_STATUS]: 'Status must be either "draft" or "published".',
	[ErrorCode.ACCOUNT_SUSPENDED]: "This account has been suspended. Contact the administrator if you believe this is a mistake.",
	[ErrorCode.NOT_ADMIN]: "You are not an administrator.",
	[ErrorCode.BACKUP_UNAVAILABLE]: "Backups are not available on this instance.",
	[ErrorCode.BACKUP_INVALID]: "That backup is not a usable database.",
	[ErrorCode.STORAGE_QUOTA_EXCEEDED]:
		"You have used all of your storage allowance. Delete some images, or contact the administrator to have your limit raised.",
};

const statuses: Partial<Record<ErrorCode, number>> = {
	[ErrorCode.SUCCESS]: 200,
	[ErrorCode.INVALID_TOKEN]: 401,
	[ErrorCode.UNAUTHORIZED]: 401,
	[ErrorCode.INVALID_CREDENTIALS]: 401,
	[ErrorCode.OTP_REQUIRED]: 401,
	[ErrorCode.INVALID_OTP]: 401,
	[ErrorCode.REGISTRATION_DISABLED]: 403,
	[ErrorCode.CREATOR_NOT_FOUND]: 404,
	[ErrorCode.POST_NOT_FOUND]: 404,
	[ErrorCode.NOT_FOUND]: 404,
	[ErrorCode.USERNAME_TAKEN]: 409,
	[ErrorCode.POST_ID_TAKEN]: 409,
	[ErrorCode.FILE_TOO_LARGE]: 413,
	[ErrorCode.UNSUPPORTED_FILE_TYPE]: 415,
	// 507 rather than 413: the request is not too large, the account is full.
	// The distinction matters to the panel, which tells the two apart.
	[ErrorCode.STORAGE_QUOTA_EXCEEDED]: 507,
	[ErrorCode.ACCOUNT_SUSPENDED]: 403,
	[ErrorCode.NOT_ADMIN]: 403,
	[ErrorCode.BACKUP_UNAVAILABLE]: 409,
	[ErrorCode.BACKUP_INVALID]: 422,
	[ErrorCode.RATE_LIMITED]: 429,
	[ErrorCode.DATABASE_ERROR]: 500,
	[ErrorCode.WRITE_FAILED]: 500,
	[ErrorCode.DELETE_FAILED]: 500,
	[ErrorCode.STORAGE_ERROR]: 500,
	[ErrorCode.CSRF_REJECTED]: 403,
	[ErrorCode.INTERNAL_ERROR]: 500,
};

export function errorMessage(code: ErrorCode): string {
	return messages[code] ?? messages[ErrorCode.INTERNAL_ERROR];
}

export function errorStatus(code: ErrorCode): number {
	return statuses[code] ?? 400;
}

export class ApiError extends Error {
	readonly code: ErrorCode;
	readonly status: number;
	readonly details?: Record<string, unknown>;

	constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
		super(message ?? errorMessage(code));
		this.name = "ApiError";
		this.code = code;
		this.status = errorStatus(code);
		this.details = details;
	}
}
