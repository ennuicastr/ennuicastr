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

// extern
declare var Ennuiboard: any, ECDefaultHotkeys: any;

// Since config is imported for side effects, it needs to come first
import * as config from "./config";

import * as audio from "./audio";
import * as log from "./log";
import * as net from "./net";
import * as proc from "./proc";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";

// The main entry point
function main() {
    return Promise.all([]).then(function() {
        // Load the keyboard indirection library
        //return util.loadLibrary("https://unpkg.com/ennuiboard@^1.0.0/ennuiboard.min.js");
        return util.loadLibrary("https://unpkg.com/ennuiboard@1.0.0/ennuiboard.min.js");

    }).catch(function(){}).then(function() {
        // Gamepads can be supported by default
        if (typeof Ennuiboard !== "undefined")
            Ennuiboard.enable("gamepad", {auto: true, manualPoll: true});

    }).catch(function(){}).then(function() {
        // Build the UI
        return <any> ui.mkUI();

    }).then(function() {
        // This can be loaded lazily
        ECDefaultHotkeys = {"0000c": "ecmenu-chat"};
        util.loadLibrary("hotkeys.min.js?v=4");

        // Now connect
        return net.connect();
    }).then(function() {
        proc.localProcessing(); // This will start up on its own in the background
        return audio.getAudioPerms();
    }).catch(function(ex) {
        log.pushStatus("error", ex + "\n\n" + ex.stack);
    });
}
main();


// If we're buffering, warn before closing
window.onbeforeunload = function() {
    if (net.mode === prot.mode.buffering && net.bufferedAmount())
        return "Data is still buffering to the server!";
}
