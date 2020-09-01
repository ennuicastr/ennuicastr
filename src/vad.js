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

// All local processing: The VAD, wave display, and noise reduction
function localProcessing() {
    if (!userMedia) {
        // Need our MediaSource first!
        userMediaAvailableEvent.addEventListener("usermediaready", localProcessing, {once: true});
        return;
    }

    if (typeof NoiseRepellent === "undefined" ||
        !NoiseRepellent.ready) {
        // Load the library first
        NoiseRepellent = {base: "noise-repellent"};
        var scr = dce("script");
        scr.async = true;
        scr.src = "noise-repellent/noise-repellent.js";

        scr.onload = function() {
            if (NoiseRepellent.ready)
                localProcessing();
            else
                NoiseRepellent.onready = localProcessing;
        };

        document.body.appendChild(scr);
        return;
    }

    // Set our lastSentTime now so that we don't immediately report a problem
    lastSentTime = performance.now();


    // First the WebRTC VAD steps
    var m = WebRtcVad;

    var handle = m.Create();
    if (handle === 0) {
        pushStatus("failvad", "Failed to create VAD.");
        throw new Error();
    }
    if (m.Init(handle) < 0) {
        pushStatus("failvad", "Failed to initialize VAD.");
        throw new Error();
    }

    var bufSz = 640 /* 20ms at 32000Hz */;
    var dataPtr = m.malloc(bufSz * 2);
    var buf = new Int16Array(m.heap.buffer, dataPtr, bufSz * 2);
    var bi = 0;
    var timeout = null, rtcTimeout = null;

    /* WebRTC VAD is pretty finicky, so also keep track of volume as a
     * secondary gate */
    var triggerVadVolume = 0;
    var curVadVolume = 0;

    m.set_mode(3);


    // Now the noise repellent steps
    var nr = null;
    if (useRTC) {
        nr = new NoiseRepellent.NoiseRepellent(ac.sampleRate);
        nr.set(NoiseRepellent.N_ADAPTIVE, 1);
        nr.set(NoiseRepellent.AMOUNT, 20);
        nr.set(NoiseRepellent.WHITENING, 50);
    }


    // Now the display steps

    // Create a canvas for it
    var wc = ui.waveCanvas;

    // Now the background is nothing, so should just be grey
    document.body.style.backgroundColor = "#111";

    // The VAD needs packets in odd intervals
    var step = ac.sampleRate / 32000;

    // Create our script processor
    var sp = createScriptProcessor(ac, userMedia, 1024);
    var destination = sp.destination;
    sp = sp.scriptProcessor;

    function rtcVad(to) {
        destination.getTracks().forEach(function(track) {
            track.enabled = to;
        });
    }
    rtcVad(false);

    // Now anything that needs its output can get it
    userMediaRTC = destination;
    userMediaAvailableEvent.dispatchEvent(new CustomEvent("usermediartcready", {}));

    // The actual processing
    sp.onaudioprocess = function(ev) {
        // Merge together the channels
        var ib = ev.inputBuffer.getChannelData(0);
        var cc = ev.inputBuffer.numberOfChannels;
        if (cc !== 1) {
            ib = ib.slice(0);

            // Mix it
            for (var i = 1; i < cc; i++) {
                var ibc = ev.inputBuffer.getChannelData(i);
                for (var j = 0; j < ib.length; j++)
                    ib[j] += ibc[j];
            }

            // Then temper it
            for (var i = 0; i < ib.length; i++)
                ib[i] /= cc;
        }

        // Transfer data for the VAD
        var vadSet = rawVadOn;
        var curVolume = 0;
        for (var i = 0; i < ib.length; i += step) {
            var v = ib[~~i];
            var a = Math.abs(v);
            curVolume += a;
            curVadVolume += a;

            buf[bi++] = v * 0x7FFF;

            if (bi == bufSz) {
                // We have a complete packet
                vadSet = !!m.Process(handle, 32000, dataPtr, bufSz);
                bi = 0;

                if (vadSet) {
                    // Adjust the trigger value
                    triggerVadVolume = (
                            triggerVadVolume * 15 +
                            curVadVolume/bufSz/2
                        ) / 16;
                    curVadVolume = 0;
                }
            }
        }

        // Possibly swap the VAD mode
        if (vadSet) {
            // Our transmission VAD has a hair trigger
            if (!rtcVadOn) {
                rtcVadOn = true;
                rtcVad(true);
            } else if (rtcTimeout) {
                clearTimeout(rtcTimeout);
                rtcTimeout = null;
            }

            // Gate the normal VAD by volume
            if (curVolume/ib.length >= triggerVadVolume) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                if (!rawVadOn) {
                    // We flipped on
                    if (!vadOn) {
                        updateWaveRetroactive();
                        updateSpeech(null, true);
                    }
                    rawVadOn = true;
                    curVadVolume = 0;
                }
            }

        } else {
            if (rtcVadOn) {
                // Flip off after a second
                if (!rtcTimeout) {
                    rtcTimeout = setTimeout(function() {
                        rtcTimeout = null;
                        rtcVadOn = false;
                        rtcVad(false);
                    }, rtcVadExtension);
                }
            }

            if (rawVadOn) {
                // Flip off after a while
                rawVadOn = false;
                if (!timeout) {
                    timeout = setTimeout(function() {
                        timeout = null;
                        updateSpeech(null, false);
                    }, vadExtension);
                }
            }
        }


        /* Our actual script processing step: noise reduction, only for RTC
         * (live voice chat) */
        if (nr) {
            var ob;
            if (useNR)
                ob = nr.run(ib);
            else
                ob = ib;
            var cc = ev.outputBuffer.numberOfChannels;
            for (var oi = 0; oi < cc; oi++)
                ev.outputBuffer.getChannelData(oi).set(ob);
        }


        // And display
        for (var part = 0; part < ib.length; part += 1024) {
            // Find the max for this range
            var max = 0;
            var end = part + 1024;
            for (var i = part; i < end; i++) {
                var v = ib[i];
                if (v < 0) v = -v;
                if (v > max) max = v;
            }

            // Bump up surrounding ones to make the wave look nicer
            if (waveData.length > 0) {
                var last = waveData.pop();
                if (last < max)
                    last = (last+max)/2;
                else
                    max = (last+max)/2;
                waveData.push(last);
            }

            waveData.push(max);
            if (!transmitting)
                waveVADs.push(0);
            else if (rawVadOn)
                waveVADs.push(3);
            else if (vadOn)
                waveVADs.push(2);
            else
                waveVADs.push(1);
        }

        updateWave(max);
    };

    // Restart if we change devices
    userMediaAvailableEvent.addEventListener("usermediastopped", function() {
        if (nr) {
            nr.cleanup();
            nr = null;
        }
        localProcessing();
    }, {once: true});
}

// Update the wave display when we retroactively promote VAD data
function updateWaveRetroactive() {
    var timeout = Math.ceil(sampleRate*vadExtension/1024000);
    var i = Math.max(waveVADs.length - timeout, 0);
    for (; i < waveVADs.length; i++)
        waveVADs[i] = (waveVADs[i] === 1) ? 2 : waveVADs[i];
}

// Constant used by updateWave
var e4 = Math.exp(4);

// Update the wave display
function updateWave(value) {
    var wc = ui.waveCanvas;

    // Display an issue if we haven't sent recently
    var sentRecently = (lastSentTime > performance.now()-1500);
    if (sentRecently)
        popStatus("notencoding");
    else
        pushStatus("notencoding", "Audio encoding is not functioning!");

    // Start from the element size
    var w = ui.waveWrapper.offsetWidth;
    var h = ui.waveWrapper.offsetHeight;

    // Rotate if our view is vertical
    if (w/h < 4/3) {
        if (!ui.waveRotate) {
            ui.waveWatcher.style.visibility = "hidden";
            ui.waveRotate = true;
        }
    } else {
        if (ui.waveRotate) {
            ui.waveWatcher.style.visibility = "";
            ui.waveRotate = false;
        }

    }

    // Make sure the canvases are correct
    if (+wc.width !== w)
        wc.width = w;
    if (+wc.height !== h)
        wc.height = h;

    if (ui.waveRotate) {
        var tmp = w;
        w = h;
        h = tmp;
    }

    // Half the wave height is a more useful value
    h = Math.floor(h/2);

    // Figure out the width of each sample
    var sw = Math.max(Math.floor(w/468), 1);
    var dw = Math.ceil(w/sw);

    // Make sure we have an appropriate amount of data
    while (waveData.length > dw) {
        waveData.shift();
        waveVADs.shift();
    }
    while (waveData.length < dw) {
        waveData.unshift(0);
        waveVADs.unshift(0);
    }

    // Figure out the height of the display
    var dh = Math.min(Math.max.apply(Math, waveData) * 1.5, 1);
    if (dh < 0.06) dh = 0.06; // Make sure the too-quiet bars are always visible

    // Figure out whether it should be colored at all
    var good = connected && transmitting && timeOffset && sentRecently;

    // And draw it
    var ctx = wc.getContext("2d");
    var i, p;
    ctx.save();
    if (ui.waveRotate) {
        ctx.rotate(Math.PI/2);
        ctx.translate(0, -2*h);
    }

    // A function for drawing our level warning bars
    function levelBar(at, color) {
        if (dh <= at) return;
        var y = Math.log(at/dh * e4) / 4 * h;
        ctx.fillStyle = color;
        ctx.fillRect(0, h-y-1, w, 1);
        ctx.fillRect(0, h+y, w, 1);
    }

    // Background color
    ctx.fillStyle = "#033";
    ctx.fillRect(0, 0, w, h*2);

    // Level bar at 0.4% for "too soft"
    levelBar(0.004, "#333");

    // Each column
    for (i = 0, p = 0; i < dw; i++, p += sw) {
        var d = Math.max(Math.log((waveData[i] / dh) * e4) / 4, 0) * h;
        if (d === 0) d = 1;
        ctx.fillStyle = good ? waveVADColors[waveVADs[i]] : "#000";
        ctx.fillRect(p, h-d, sw, 2*d);
    }

    // Level bar at 90% for "too loud"
    levelBar(0.9, "#700");

    ctx.restore();
}
