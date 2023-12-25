/*
 * Copyright (c) 2018-2023 Yahweasel
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

import * as audio from "./audio";
import * as avloader from "./avloader";
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
        await util.loadLibrary({
            file: "libs/ennuiboard.min.js",
            name: "hotkey library"
        });
    } catch (ex) {}
    if (typeof Ennuiboard !== "undefined")
        Ennuiboard.enable("gamepad", {auto: true, manualPoll: true});
    await avloader.loadLibAV();

    try {
        // Build the UI
        await uiImpl.mkUI();

        // This can be loaded lazily
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ECDefaultHotkeys = {"0000c": "ecmenu-chat"};
        util.loadLibrary({
            file: "hotkeys.min.js?v=5",
            name: "hotkey library"
        });

        // Resolve the configuration for lobbies
        await config.resolve();

        // Now connect
        await net.connect();

        // This will start up on its own in the background
        proc.localProcessing(0);
        if (config.useRTC)
            commImpl.initComms();

        // Get audio permissions, continuing on to making the audio UI
        await audio.inputs[0].getAudioPerms(uiImpl.mkAudioUI);

    } catch (ex) {
        ex = ex || 0;
        try {
            log.pushStatus("error", util.escape(ex + "") + "\n\n" + util.escape(ex.stack + ""));
        } catch (logEx) {
            alert(ex + "\n\n" + ex.stack);
        }
    }
}
main();

// If we're buffering, warn before closing
window.onbeforeunload = function() {
    if (net.mode === prot.mode.buffering && net.bufferedAmount())
        return "Data is still buffering to the server!";
}
