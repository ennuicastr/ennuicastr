/*
 * Copyright (c) 2018-2022 Yahweasel
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
 * Loader for libav.js.
 */

// extern
declare let LibAV: any;

import * as util from "./util";

// libav version to load
const libavVersion = "3.8.5.1";

// Load LibAV if it's not already loaded
let loadLibAVPromise: Promise<unknown> = null;
export function loadLibAV(): Promise<unknown> {
    if (loadLibAVPromise) {
        // Already loading or loaded
        return loadLibAVPromise;
    }

    if (typeof LibAV === "undefined")
        (<any> window).LibAV = {};
    LibAV.base = "libav";

    loadLibAVPromise = (async () => {
        // First load the wrapper
        await util.loadLibrary({
            file: `libav/libav-${libavVersion}-ennuicastr.js`,
            name: "audio encoder"
        });

        // Use that to decide what target to preload
        try {
            const target = LibAV.target();
            await util.loadLibrary({
                file: `libav/libav-${libavVersion}-ennuicastr.${target}.js`,
                name: "audio encoder"
            }, {
                noLoad: true,
                extras: [{
                    file: `libav/libav-${libavVersion}-ennuicastr.${target}.wasm`,
                    name: "audio encoder"
                }]
            });
        } catch (ex) {}
    })();

    return loadLibAVPromise;
}
