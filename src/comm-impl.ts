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
 * Selection of communication drivers.
 */

import * as comm from "./comm";
import * as config from "./config";
import * as ctcp from "./ctcp";
import * as jitsi from "./jitsi";
import * as rtennui from "./rtennui";

export async function initComms(): Promise<void> {
    // CTCP communications
    const c = new ctcp.CTCPVideoRec();
    comm.comms.videoRec = c;
    await c.init({data: true});

    // Jitsi communications
    const useJitsi = {
        video: !config.useRTEnnui.video,
        audio: !config.useRTEnnui.audio,
        broadcast: true,
        data: false
    };

    const j = new jitsi.Jitsi();
    comm.comms.broadcast = j;
    if (useJitsi.video)
        comm.comms.video = j;
    if (useJitsi.audio)
        comm.comms.audio = j;
    await j.init(useJitsi);

    // RTEnnui communications
    const useRTEnnui = config.useRTEnnui;
    if (useRTEnnui.audio) {
        const e = new rtennui.RTEnnui();
        if (useRTEnnui.video)
            comm.comms.video = e;
        if (useRTEnnui.audio)
            comm.comms.audio = e;
        await e.init(useRTEnnui);
    }
}
