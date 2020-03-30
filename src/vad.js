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

// Create a VAD and wave display
function localProcessing() {
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
    var timeout = null;

    /* WebRTC VAD is pretty finicky, so also keep track of volume as a
     * secondary gate */
    var triggerVadVolume = 0;
    var curVadVolume = 0;

    m.set_mode(3);


    // Now the display steps

    // Create a canvas for it
    if (!ui.waveCanvas)
        mkUI(true);
    var wc = ui.waveCanvas;

    // Now the background is nothing, so should just be grey
    document.body.style.backgroundColor = "#111";

    // Create our watcher image
    var img = dce("img");
    img.style.display = "none";
    img.style.position = "absolute";
    img.style.left = "0px";
    img.style.top = "0px";
    img.style.height = "0px"; // Changed automatically when data arrives
    ui.waveWatcher = img;
    document.body.appendChild(img);

    // And choose its type based on support
    function usePng() {
        img.src = "images/watcher.png";
        img.style.display = "";
    }
    if (!window.createImageBitmap || !window.fetch) {
        usePng();
    } else {
        var sample = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
        fetch(sample).then(function(res) {
            return res.blob();
        }).then(function(blob) {
            return createImageBitmap(blob)
        }).then(function() {
            img.src = "images/watcher.webp";
            img.style.display = "";
        }).catch(usePng);
    }

    // Make the log display appropriate
    log.classList.add("status");

    // The VAD needs packets in odd intervals
    var step = ac.sampleRate / 32000;

    // Set up the audio processor for both VAD and display
    var mss = ac.createMediaStreamSource(userMedia);
    /* NOTE: We don't actually care about output, but Chrome won't run a
     * script processor with 0 outputs */
    var sp = ac.createScriptProcessor(1024, 1, 1);
    sp.connect(ac.destination);
    sp.onaudioprocess = function(ev) {
        var ib = ev.inputBuffer.getChannelData(0);

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
        if (rawVadOn)
            curVadTime += ib.length;

        if (vadSet) {
            // Gate by volume
            if (curVolume/ib.length >= triggerVadVolume) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                if (!rawVadOn) {
                    // We flipped on
                    if (!vadOn)
                        updateWaveRetroactive();
                    rawVadOn = vadOn = true;
                    curVadVolume = curVadTime = 0;
                }
            }
        } else if (rawVadOn) {
            // We flipped off
            rawVadOn = false;
            if (!timeout) {
                timeout = setTimeout(function() {
                    vadOn = false;
                    timeout = null;
                }, vadExtension);
            }
        }


        // And display

        // Find the max for this range
        var max = 0;
        var ib = ev.inputBuffer.getChannelData(0);
        for (var i = 0; i < ib.length; ib++) {
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
        updateWave(max);
    };
    mss.connect(sp);

    ac.addEventListener("disconnected", function() {
        updateWave(1);
        mss.disconnect(sp);
        sp.disconnect(ac.destination);
    });
}

// Update the wave display when we retroactively promote VAD data
function updateWaveRetroactive() {
    var timeout = Math.ceil(sampleRate*vadExtension/1024000);
    var i = Math.max(waveVADs.length - timeout, 0);
    for (; i < waveVADs.length; i++)
        waveVADs[i] = (waveVADs[i] === 1) ? 2 : waveVADs[i];
}

// Update the wave display
function updateWave(value) {
    // Display an issue if we haven't sent recently
    var sentRecently = (lastSentTime > performance.now()-1000);
    if (sentRecently)
        popStatus("notencoding");
    else
        pushStatus("notencoding", "Audio encoding is not functioning!");

    // Start from the element size
    var w = Math.min(window.innerWidth, window.outerWidth);
    var h = Math.min(window.innerHeight, window.outerHeight) - log.offsetHeight;

    // If we have any other modules open, shrink the waveform view
    if (ui.postWrapper.childNodes.length)
        h = 160;

    // Rotate if our view is vertical
    if (h > w) {
        if (!ui.waveRotate) {
            ui.waveWatcher.style.visibility = "hidden";
            ui.waveRotate = true;
        }
    } else {
        if (ui.waveRotate) {
            ui.waveWatcher.style.visibility = "";
            ui.waveRotate = false;
        }
        if (h > w/2) h = Math.ceil(w/2);
    }

    // Make sure the canvases are correct
    var wc = ui.waveCanvas;
    if (+wc.width !== w)
        wc.width = w;
    if (+wc.height !== h)
        wc.height = h;
    if (wc.style.height !== h+"px")
        wc.style.height = h+"px";
    if (ui.waveWatcher.style.height !== h+"px")
        ui.waveWatcher.style.height = h+"px";

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
    ctx.fillStyle = "#033";
    ctx.fillRect(0, 0, w, h*2);
    for (i = 0, p = 0; i < dw; i++, p += sw) {
        var d = Math.max(Math.log((waveData[i] / dh) * 54.598150033) / 4, 0) * h;
        if (d === 0) d = 1;
        ctx.fillStyle = good ? waveVADColors[waveVADs[i]] : "#000";
        ctx.fillRect(p, h-d, sw, 2*d);
    }
    ctx.restore();
}
