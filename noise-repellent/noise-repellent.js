/*
 * Copyright (C) 2020 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

(function() {
    function isWebAssemblySupported() {
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

    var nrepel;
    var base = ".";
    var nodejs = (typeof process !== "undefined");
    var wasm = isWebAssemblySupported();

    if (!nodejs) {
        if (typeof NoiseRepellent === "undefined")
            NoiseRepellent = {};
        nrepel = NoiseRepellent;
        if (nrepel.base)
            base = nrepel.base;

    } else {
        // Just load it directly
        nrepel = NoiseRepellent = require("./noise-repellent." + (wasm?"w":"") + "asm.js");

    }

    // Wrap our own onready for more useful feedback
    nrepel.ready = false;
    nrepel.onRuntimeInitialized = function() {
        nrepel.ready = true;
        if (nrepel.onready)
            nrepel.onready();
    };

    // And load it
    if (!nodejs) {
        var scr = document.createElement("script");
        scr.src = base + "/noise-repellent." + (wasm?"w":"") + "asm.js";
        scr.async = true;
        document.body.appendChild(scr);
    } else {
        module.exports = nrepel;
        if (!wasm)
            nrepel.onRuntimeInitialized();
    }
})();
