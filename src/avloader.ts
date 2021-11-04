/*
 * Copyright (c) 2018-2021 Yahweasel
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

// extern
declare let LibAV: any;

import * as util from "./util";

// libav version to load
const libavVersion = "2.5.4.4";

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

    loadLibAVPromise = util.loadLibrary("libav/libav-" + libavVersion + "-ennuicastr.js");
    return loadLibAVPromise;
}
