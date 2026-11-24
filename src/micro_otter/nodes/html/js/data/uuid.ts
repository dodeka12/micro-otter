/**
 * Validates and normalizes a UUID v4 string.
 *
 * Ensures the provided value is a non-empty string, trims whitespace,
 * and verifies it matches the UUID v4 format. Throws an error when
 * the value is missing, empty, or not in the correct format.
 *
 * @param {string} value - The UUID v4 string to validate.
 * @returns {string} The trimmed, validated UUID v4 string.
 * @throws {TypeError} If the value is not a non-empty string.
 * @throws {Error} If the value does not match the UUID v4 pattern.
 */
function assertUuidV4(value: string): string {
    if (typeof value === 'string' && value.trim()) {
        const normalized = value.trim();
        const uuidPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(normalized)) {
            throw new Error(`Invalid UUID v4 format: "${normalized}".`);
        }
        return normalized;
    }
    throw new TypeError('UUID v4 must be a non-empty string.');
}

/**
 * Generates a pseudo-random UUID v4-like identifier.
 *
 * @returns {string} A newly generated unique identifier string.
 */
function generateUuidV4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const randomNibble = (Math.random() * 16) | 0;
        const uuidNibble = c === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8;
        return uuidNibble.toString(16);
    });
}

export { assertUuidV4, generateUuidV4 };
