As a password manager user, it's important to ensure that your passwords are stored and transmitted in a secure manner. One way to do this is by using strong encryption algorithms to protect your data.

If you're looking for a password manager that uses state-of-the-art encryption and hashing techniques, you might want to consider Passky. [Passky](https://passky.org) is a password manager that uses XChaCha20 for password encryption and Argon2id for password hashing.

Here are a few reasons why XChaCha20 and Argon2id are good choices for a password manager:

- **XChaCha20 is faster than AES**: In many cases, XChaCha20 can encrypt and decrypt data faster than AES. This can be especially beneficial for password managers that need to quickly retrieve and decrypt large numbers of passwords.

- **XChaCha20 has a larger key size**: AES has a key size of 128 bits, 192 bits, or 256 bits. While these key sizes are sufficient for most purposes, XChaCha20 has a key size of 256 bits, which provides an additional layer of security.

- **XChaCha20 is more resistant to certain attacks**: XChaCha20 has been specifically designed to be resistant to side-channel attacks, which are a type of attack that can extract information from the physical implementation of an algorithm (e.g., through measurements of power consumption or electromagnetic radiation).

- **XChaCha20 has a nonce-misuse resistant design**: A nonce is a value that is used only once in the encryption process. In some cases, nonces can be reused, which can compromise the security of the encryption. XChaCha20 has a design that makes it resistant to nonce reuse, which adds an additional layer of security.

- **Argon2id is more secure than PBKDF2**: PBKDF2 (Password-Based Key Derivation Function 2) is a widely-used algorithm for hashing passwords. However, Argon2id is considered to be more secure, as it is designed to be resistant to GPU cracking and other types of attacks.

- **Argon2id is a winner of the [Password Hashing Competition](https://www.password-hashing.net)**: In 2015, a group of cryptography experts conducted the Password Hashing Competition to find the most secure algorithm for hashing passwords. Argon2id was selected as the winner, beating out over 50 other contenders.

- **Argon2id is more memory-hard**: Memory-hardness refers to the amount of memory required to compute the hash function. PBKDF2 is not very memory-hard, which means that it can be computed relatively quickly even on devices with limited memory. In contrast, Argon2id is designed to be more memory-hard, which makes it more resistant to certain types of attacks that rely on using large amounts of memory (e.g., GPU cracking).

- **Argon2id is more parallelizable**: Parallelization refers to the ability to split up the computation of a hash function into smaller pieces that can be computed simultaneously. PBKDF2 is not very parallelizable, which means that it is not well-suited to being computed on devices with multiple cores (e.g., CPUs with multiple threads or GPUs). In contrast, Argon2id is designed to be more parallelizable, which makes it more suitable for use on devices with multiple cores.

- **Argon2id has multiple variants**: There are three main variants of Argon2: Argon2i, Argon2d, and Argon2id. Argon2i is designed to be resistant to side-channel attacks, Argon2d is designed to be resistant to GPU cracking, and Argon2id combines the features of both Argon2i and Argon2d. This means that Argon2id is a good choice for a password hashing algorithm that needs to be resistant to a wide range of attacks.

- **Argon2id can use more than one type of hardware**: PBKDF2 is primarily designed to run on CPUs, but Argon2id can take advantage of multiple types of hardware, including CPUs, GPUs, and even specialized password cracking devices. This makes it more difficult for attackers to use specialized hardware to crack hashed passwords.

Overall, [Passky](https://passky.org)'s use of XChaCha20 and Argon2id makes it a secure and reliable choice for storing and managing your passwords.