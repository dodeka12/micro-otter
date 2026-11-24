// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Convert any thrown value into a readable error message string.
 */
export function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === 'object' && error !== null && 'message' in error) {
        const maybeMessage = (error as { message?: unknown }).message;
        if (typeof maybeMessage === 'string') {
            return maybeMessage;
        }
    }

    return String(error);
}
