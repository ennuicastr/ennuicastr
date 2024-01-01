/*
 * Copyright (c) 2018-2024 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/*
 * This file is part of Ennuicastr.
 *
 * Utility functions.
 */

import { prot } from "./protocol";

/* We need an event target we can use. "usermediaready" fires when userMedia is
 * ready. "usermediastopped" fires when it stops. "usermediavideoready" fires
 * when video is ready. "spmediaready" fires when the media device that's
 * processed through the ScriptProcessor is ready. */
export let events: EventTarget;
try {
    events = new EventTarget();
} catch (ex) {
    // No EventTarget
    events = window;
}

// Dispatch an event
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function dispatchEvent(name: string, arg?: any): void {
    events.dispatchEvent(new CustomEvent(name, {detail: arg}));
}

// Add an event listener for a net packet
export function netEvent(sock: string, cmd: string, handler: (ev: CustomEvent)=>unknown): void {
    events.addEventListener("net." + sock + "Sock." + prot.ids[cmd], handler);
}

// Basic DOM stuff
export const dce = document.createElement.bind(document);
export const gebi = document.getElementById.bind(document);

export function encodeText(text: string): Uint8Array {
    if (window.TextEncoder) {
        return new TextEncoder().encode(text);
    } else {
        // I don't care to do this right, ASCII only
        const ret = new Uint8Array(text.length);
        for (let ni = 0; ni < text.length; ni++) {
            let cc = text.charCodeAt(ni);
            if (cc > 127)
                cc = 95;
            ret[ni] = cc;
        }
        return ret;
    }
}

export function decodeText(text: ArrayBuffer): string {
    if (window.TextDecoder) {
        return new TextDecoder("utf-8").decode(text);
    } else {
        let ret = "";
        const t8 = new Uint8Array(text);
        for (let ni = 0; ni < t8.length; ni++) {
            ret += String.fromCharCode(t8[ni]);
        }
        return ret;
    }
}

export function bytesToRepr(x: number): string {
    const suffixes = ["B", "KiB", "MiB", "GiB"];
    while (suffixes.length > 1 && x >= 1024) {
        x /= 1024;
        suffixes.shift();
    }
    return Math.round(x) + suffixes[0];
}

// Escape a string for HTML
export function escape(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export function isChrome() {
    return navigator.userAgent.indexOf("Chrome") >= 0;
}

// We provide a wrapper around the loader in ecloader.js
interface Library {
    name: string;
    file: string;
}

declare function ecLoadLibrary(
    lib: Library, opts?: {
        extras?: Library[],
        noLoad?: boolean
    }
): Promise<unknown>;

export function loadLibrary(
    lib: Library, opts: {
        extras?: Library[],
        noLoad?: boolean
    } = {}
): Promise<unknown> {
    return ecLoadLibrary(lib, opts);
}
