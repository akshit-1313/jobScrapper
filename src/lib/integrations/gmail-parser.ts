import { gmail_v1 } from 'googleapis';

export const MAX_GMAIL_CONTENT_CHARS = 10000;

export interface ExtractedEmail {
    messageId: string;
    threadId: string | null;
    content: string;
    contentType: 'text/plain' | 'text/html' | 'empty';
    truncated: boolean;
    originalLength: number;
}

export interface ParserResult {
    success: boolean;
    data?: ExtractedEmail;
    error?: string;
}

/**
 * Safely decodes base64url encoded strings often found in Gmail payloads.
 */
function safeBase64UrlDecode(encoded: string): string {
    // Strictly validate base64url characters (A-Z, a-z, 0-9, -, _) plus '='.
    // The Gmail API emits PADDED base64url, so '=' is valid input here — but only
    // as trailing padding, never mid-string.
    if (/[^A-Za-z0-9\-_=]/.test(encoded) || /=[^=]/.test(encoded)) {
        throw new Error('Malformed base64url encoding');
    }

    try {
        // Strip whatever padding Gmail supplied before recomputing it, so the
        // input is never double-padded.
        const unpadded = encoded.replace(/=+$/, '');

        const m = unpadded.length % 4;
        // A remainder of 1 cannot be produced by valid base64.
        if (m === 1) {
            throw new Error('Malformed base64url encoding');
        }
        const padding = m ? '='.repeat(4 - m) : '';
        const base64 = (unpadded + padding).replace(/-/g, '+').replace(/_/g, '/');

        // Decode to UTF-8
        return Buffer.from(base64, 'base64').toString('utf-8');
    } catch {
        throw new Error('Malformed base64url encoding');
    }
}

/**
 * Strips HTML structure and outputs pure text safely without relying on external large dependencies.
 */
function stripHtmlConservative(html: string): string {
    // Remove script and style tags and their contents safely
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');

    // Replace structural blocks with spaces or newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>|<\/div>|<\/tr>|<\/li>/gi, '\n');

    // Remove all remaining tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Quick entity decoding for standard characters
    text = text.replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    return text;
}

/**
 * Removes extensive quoted replies often found in email chains (e.g. "> On ... wrote:").
 * Conservative: only drops if patterns strictly imply history.
 */
function removeQuotedReplyBlocks(text: string): string {
    // A standard Gmail style reply boundary usually starts with "On [Date], [Name] wrote:"
    // It can be multiline due to text wrapping.
    const onWroteRegex = /(\n?\s*On\s+.{10,200}?wrote:\s*\n\s*>)/i;

    // Standard blockquote boundary in text emails (multiple >)
    // We try to identify sequences of heavily blockquoted text.

    // Approach: split on the "On ... wrote:" phrase and discard everything after
    const match = text.match(onWroteRegex);
    if (match && match.index !== undefined) {
        // We throw away the rest if it represents a quoted block
        text = text.substring(0, match.index);
    }

    // Secondary pass: if there are raw "From: ... Sent: ... To: ..." headers indicating a forwarded/replied message,
    // we also truncate at their start conservatively.
    const fromSentRegex = /(\n?\s*From:\s*.{5,100}\n\s*Sent:\s*.{5,100}\n)/i;
    const fsMatch = text.match(fromSentRegex);
    if (fsMatch && fsMatch.index !== undefined) {
        text = text.substring(0, fsMatch.index);
    }

    // Also remove lines that consist ONLY of > markers and trailing whitespace
    const lines = text.split('\n');
    const cleanedLines = lines.filter(line => !/^\s*(>.*?)+$/.test(line.trim()));

    return cleanedLines.join('\n');
}

/**
 * Normalizes text, stripping arbitrary excessive spacing or blank lines.
 */
function normalizeText(text: string): string {
    let normalized = removeQuotedReplyBlocks(text);
    // Replace multiple empty lines with a single empty line
    normalized = normalized.replace(/\n{3,}/g, '\n\n');
    // Condense excessive spaces while surviving tabs/newlines
    normalized = normalized.replace(/[ \t]{2,}/g, ' ');
    return normalized.trim();
}

interface Accumulated {
    text?: string;
    html?: string;
    /** Count of parts whose body failed to decode; used to distinguish "malformed" from "genuinely empty". */
    failedParts: number;
}

/**
 * Recursively locates the best text bodies within a Gmail Message Payload.
 */
function traverseParts(part: gmail_v1.Schema$MessagePart, accumulated: Accumulated) {
    // If it's an attachment, do not process
    if (part.filename && part.filename.length > 0) {
        return;
    }

    // Read the body if it matches text types.
    // Decode failures are isolated PER PART: a malformed fallback part must not
    // discard a sibling part that decoded cleanly (real Gmail messages routinely
    // pad one part and not the other).
    if (part.mimeType === 'text/plain' && part.body?.data) {
        try {
            accumulated.text = (accumulated.text || '') + safeBase64UrlDecode(part.body.data);
        } catch {
            accumulated.failedParts++;
        }
    } else if (part.mimeType === 'text/html' && part.body?.data) {
        try {
            accumulated.html = (accumulated.html || '') + safeBase64UrlDecode(part.body.data);
        } catch {
            accumulated.failedParts++;
        }
    }

    // Traverse recursively
    if (part.parts && Array.isArray(part.parts)) {
        for (const childPart of part.parts) {
            traverseParts(childPart, accumulated);
        }
    }
}

/**
 * Primary pure utility extracting bounded content from a Gmail API message.
 */
export function extractBoundedContent(message: gmail_v1.Schema$Message): ParserResult {
    try {
        if (!message) {
            return { success: false, error: 'Empty message' };
        }

        const messageId = message.id;
        const threadId = message.threadId || null;

        if (!messageId) {
            return { success: false, error: 'Malformed message: missing id' };
        }

        const payload = message.payload;
        if (!payload) {
            // Technically a valid message could have no payload body depending on API parameters,
            // but for deep extract we expect a full payload.
            return {
                success: true,
                data: {
                    messageId,
                    threadId,
                    content: '',
                    contentType: 'empty',
                    truncated: false,
                    originalLength: 0
                }
            };
        }

        const accumulated: Accumulated = { text: undefined, html: undefined, failedParts: 0 };

        // Top level could be the body itself
        if (payload.body && payload.body.data && payload.mimeType?.startsWith('text/')) {
            if (payload.mimeType === 'text/plain') {
                accumulated.text = safeBase64UrlDecode(payload.body.data);
            } else if (payload.mimeType === 'text/html') {
                accumulated.html = safeBase64UrlDecode(payload.body.data);
            }
        }

        // Otherwise, traverse parts
        if (payload.parts) {
            traverseParts(payload, accumulated);
        }

        let rawContent = '';
        let contentType: 'text/plain' | 'text/html' | 'empty' = 'empty';

        // 1. Priority text/plain
        if (accumulated.text && accumulated.text.trim().length > 0) {
            rawContent = accumulated.text;
            contentType = 'text/plain';
        }
        // 2. Fallback text/html
        else if (accumulated.html && accumulated.html.trim().length > 0) {
            rawContent = stripHtmlConservative(accumulated.html);
            contentType = 'text/html';
        } else if (accumulated.failedParts > 0) {
            // No part yielded text AND at least one failed to decode: this is a
            // malformed message, not an empty one. Report it as such so the caller
            // does not misattribute it to "no content".
            return { success: false, error: 'Malformed base64url encoding' };
        } else {
            return {
                success: true,
                data: {
                    messageId,
                    threadId,
                    content: '',
                    contentType: 'empty',
                    truncated: false,
                    originalLength: 0
                }
            };
        }

        // Apply normalizations
        let finalContent = normalizeText(rawContent);
        const originalLength = finalContent.length;

        // Apply Hard Boundary
        let truncated = false;
        if (finalContent.length > MAX_GMAIL_CONTENT_CHARS) {
            finalContent = finalContent.substring(0, MAX_GMAIL_CONTENT_CHARS);
            truncated = true;
        }

        return {
            success: true,
            data: {
                messageId,
                threadId,
                content: finalContent,
                contentType,
                truncated,
                originalLength
            }
        };

    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Unknown acquisition failure' };
    }
}
