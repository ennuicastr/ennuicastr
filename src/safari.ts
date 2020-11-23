/*
 * Copyright (c) 2020 Yahweasel
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
declare var webkitAudioContext: any;

import * as audio from "./audio";

// Safari-specific workarounds for scriptProcessor
export function createScriptProcessor(ac: AudioContext, ms: MediaStream, bufferSize: number) {
    if (typeof webkitAudioContext !== "undefined")
        return createSafariScriptProcessor(ac, ms, bufferSize);

    // All other browsers
    var ret = ac.createScriptProcessor(bufferSize);
    var mss = ac.createMediaStreamSource(ms);
    mss.connect(ret);
    var destination = ac.createMediaStreamDestination();
    ret.connect(destination);

    // Disconnect it when user media stops
    audio.userMediaAvailableEvent.addEventListener("usermediastopped", function() {
        mss.disconnect(ret);
        ret.disconnect(destination);
    }, {once: true});

    return {
        scriptProcessor: ret,
        destination: destination.stream
    };
}

// Safari-specific
function createSafariScriptProcessor(ac: any, ms: MediaStream, bufferSize: number) {
    /* Safari has major problems if you have more than one ScriptProcessor, so
     * we only allow one per MediaStream, and overload it. */
    if (!ac.ecSafariScriptProcessors)
        ac.ecSafariScriptProcessors = {};

    var sp = ac.ecSafariScriptProcessors[ms.id];
    if (!sp) {
        // Choose the older name if necessary
        var name = "createScriptProcessor";
        if (!(<any> ac)[name])
            name = "createJavaScriptNode";

        // Create our script processor with a compromise buffer size
        sp = ac.ecSafariScriptProcessors[ms.id] =
            ac[name](4096, 1, 1);

        // Keep track of who's using it
        sp.ecUsers = [];

        // And call all the users when we get data
        sp.onaudioprocess = function(ev: AudioProcessingEvent) {
            sp.ecUsers.forEach(function(user: any) {
                user.onaudioprocess(ev);
            });
        }

        // Connect it
        var mss = ac.createMediaStreamSource(ms);
        mss.connect(sp);
        var destination = ac.createMediaStreamDestination()
        sp.connect(destination);
        sp.ecDestination = destination;

        // And disconnect it when user media stops
        audio.userMediaAvailableEvent.addEventListener("usermediastopped", function() {
            mss.disconnect(sp);
            sp.disconnect(destination);
            delete ac.ecSafariScriptProcessors[ms.id];
        }, {once: true});
    }

    // Now create the user object for this
    var user = {
        onaudioprocess: function() {}
    };
    sp.ecUsers.push(user);

    // That tiny object is our fake interface
    return {
        scriptProcessor: user,
        destination: sp.ecDestination.stream
    };
}
