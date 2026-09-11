import PasswordGenerator from "@rabbit-company/password-generator";

const secrets = {
	ENCRYPTION_KEY: PasswordGenerator.generate(64, true, true, false),
	ADMIN_TOKEN: PasswordGenerator.generate(64, true, true, false),
};

for (const [name, value] of Object.entries(secrets)) {
	console.log(`${name}=${value}`);
}
