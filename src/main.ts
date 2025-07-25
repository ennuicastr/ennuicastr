/*
 * Copyright (c) 2018-2025 Yahweasel
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

import * as audio from "./audio";
import * as avloader from "./avloader";
import * as commImpl from "./comm-impl";
import * as config from "./config";
import * as inproc from "./inproc";
import * as log from "./log";
import * as master from "./master";
import * as net from "./net";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as uiImpl from "./ui-impl";
import * as util from "./util";
import * as workers from "./workers";

import * as downloadStream from "@ennuicastr/dl-stream";
import { Ennuiboard } from "ennuiboard";

// The main entry point
async function main() {
    // download-stream must come first, because it may need to refresh
    await downloadStream.load();

    // Then comes config
    if (!await config.load())
        return;

    // Then libraries
    Ennuiboard.enable("gamepad", {auto: true, manualPoll: true});
    await avloader.loadLibAV();
    await util.loadLibrary({
        file: workers.allWorkers[0],
        name: "Data processing libraries"
    }, {
        extras: workers.allWorkers.map(x => ({
            file: x,
            name: "Data processing libraries"
        })),
        noLoad: true
    });

    try {
        // Build the UI
        uiImpl.mkUI();

        // This can be loaded lazily
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (<any> window).ECDefaultHotkeys = {"0000c": "ecmenu-chat"};
        util.loadLibrary({
            file: "hotkeys.min.js?v=5",
            name: "hotkey library"
        });

        // Resolve the configuration for lobbies
        await config.resolve();

        const acPromise = audio.initAudioContext();
        let waitPromises: Promise<unknown>[] = [];

        if ("master" in config.config) {
            let reqFSDH = false;
            const c = master.initCloudStorage({
                showDesc: true,
                showFSDH: (
                    !ui.ui.panels.host.saveVideoInFSDH.checked &&
                    !!(<any> window).showDirectoryPicker
                )
            });
            waitPromises.push(c.completion.promise);
            await c.transientActivation.promise;

            const f = master.initFSDHStorage();
            waitPromises.push(f.completion.promise);
            await f.transientActivation.promise;
        }

        if (ui.needTransientActivation()) {
            await ui.transientActivation(
                "Join recording",
                '<i class="bx bx-door-open"></i> Join recording',
                {makeModal: true}
            );
        }

        await acPromise;
        try {
            await Promise.all(waitPromises);
        } catch (ex) {}

        // Now connect
        await net.connect();

        // This will start up on its own in the background
        inproc.localProcessing(0);
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
