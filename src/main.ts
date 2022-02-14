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
 * Main entry point.
 */

// extern
declare let Ennuiboard: any, ECDefaultHotkeys: any;

import "webrtc-adapter";

import * as audio from "./audio";
import * as commImpl from "./comm-impl";
import * as config from "./config";
import * as downloadStream from "./download-stream";
import * as log from "./log";
import * as net from "./net";
import * as proc from "./proc";
import { prot } from "./protocol";
import * as uiImpl from "./ui-impl";
import * as util from "./util";

// The main entry point
async function main() {
    // download-stream must come first, because it may need to refresh
    await downloadStream.load();

    // Then comes config
    if (!await config.load())
        return;

    // Then libraries
    try {
        await util.loadLibrary("libs/ennuiboard.min.js");
    } catch (ex) {}
    if (typeof Ennuiboard !== "undefined")
        Ennuiboard.enable("gamepad", {auto: true, manualPoll: true});

    try {
        // Build the UI
        await uiImpl.mkUI();

        // This can be loaded lazily
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ECDefaultHotkeys = {"0000c": "ecmenu-chat"};
        util.loadLibrary("hotkeys.min.js?v=5");

        // Resolve the configuration for lobbies
        await config.resolve();

        // Now connect
        await net.connect();

        // This will start up on its own in the background
        proc.localProcessing();
        if (config.useRTC)
            commImpl.initComms();

        // Get audio permissions, which also begins the next step
        await audio.input.getAudioPerms(uiImpl.mkAudioUI);

    } catch (ex) {
        log.pushStatus("error", ex + "\n\n" + ex.stack);
    }
}
main();

// If we're buffering, warn before closing
window.onbeforeunload = function() {
    if (net.mode === prot.mode.buffering && net.bufferedAmount())
        return "Data is still buffering to the server!";
}
