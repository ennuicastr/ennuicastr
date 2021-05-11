/*
 * Copyright (c) 2018-2020 Yahweasel
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

import { prot } from "./protocol";

/* We need an event target we can use. "usermediaready" fires when userMedia is
 * ready. "usermediastopped" fires when it stops. "usermediavideoready" fires
 * when video is ready. "spmediaready" fires when the media device that's
 * processed through the ScriptProcessor is ready. */
// FIXME: This is before all the imports because of some nasty dependencies
export var events: EventTarget;
try {
    events = new EventTarget();
} catch (ex) {
    // No EventTarget
    events = window;
}

// Dispatch an event
export function dispatchEvent(name: string, arg?: any) {
    events.dispatchEvent(new CustomEvent(name, {detail: arg}));
}

// Add an event listener for a net packet
export function netEvent(sock: string, cmd: string, handler: (ev: CustomEvent)=>unknown) {
    events.addEventListener("net." + sock + "Sock." + prot.ids[cmd], handler);
}

// Basic DOM stuff
export const dce = document.createElement.bind(document);
export const gebi = document.getElementById.bind(document);

export function encodeText(text: string) {
    if (window.TextEncoder) {
        return new TextEncoder().encode(text);
    } else {
        // I don't care to do this right, ASCII only
        var ret = new Uint8Array(text.length);
        for (var ni = 0; ni < text.length; ni++) {
            var cc = text.charCodeAt(ni);
            if (cc > 127)
                cc = 95;
            ret[ni] = cc;
        }
        return ret;
    }
}

export function decodeText(text: ArrayBuffer) {
    if (window.TextDecoder) {
        return new TextDecoder("utf-8").decode(text);
    } else {
        var ret = "";
        var t8 = new Uint8Array(text);
        for (var ni = 0; ni < t8.length; ni++) {
            ret += String.fromCharCode(t8[ni]);
        }
        return ret;
    }
}

export function bytesToRepr(x: number) {
    var suffixes = ["B", "KiB", "MiB", "GiB"];
    while (suffixes.length > 1 && x >= 1024) {
        x /= 1024;
        suffixes.shift();
    }
    return Math.round(x) + suffixes[0];
}

export function isWebAssemblySupported() {
    try {
        if (typeof WebAssembly === "object" &&
            typeof WebAssembly.instantiate === "function") {
            var module = new WebAssembly.Module(
                new Uint8Array([0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
            if (module instanceof WebAssembly.Module)
                return new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
        }
    } catch (e) {
    }
    return false;
}

// Generic library loader
export function loadLibrary(name: string) {
    return new Promise(function(res, rej) {
        var scr = dce("script");
        scr.addEventListener("load", res);
        scr.addEventListener("error", rej);
        scr.src = name;
        scr.async = true;
        document.body.appendChild(scr);
    });
}
